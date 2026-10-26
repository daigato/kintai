import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { isNonWorkingDay } from './holidays'

type Bindings = {
  DB: D1Database
  LINE_CHANNEL_ACCESS_TOKEN?: string
  LINE_CHANNEL_SECRET?: string
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('/api/*', cors())

async function sha256(str: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(str)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

// --- Users API ---

app.get('/api/users', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT id, name, role, line_user_id FROM users').all()
  return c.json(results)
})

app.post('/api/login-admin', async (c) => {
  const { userId, password } = await c.req.json()
  if (!userId || !password) {
    return c.json({ error: 'ユーザーIDとパスワードを入力してください' }, 400)
  }

  const hash = await sha256(password)
  const user = await c.env.DB.prepare(
    "SELECT id, name, role, password_hash, line_user_id FROM users WHERE (id = ? OR name = ?) AND role = 'admin'"
  ).bind(userId, userId).first<{ id: string; name: string; role: string; password_hash: string; line_user_id: string }>()

  if (!user || (user.password_hash !== hash && user.password_hash !== password)) {
    return c.json({ error: 'ユーザーIDまたはパスワードが正しくありません' }, 401)
  }

  return c.json({
    id: user.id,
    name: user.name,
    role: user.role,
    line_user_id: user.line_user_id
  })
})

app.put('/api/users/:id', async (c) => {
  const id = c.req.param('id')
  const { name } = await c.req.json()
  if (!name || !name.trim()) {
    return c.json({ error: 'Name is required' }, 400)
  }
  await c.env.DB.prepare('UPDATE users SET name = ? WHERE id = ?').bind(name.trim(), id).run()
  return c.json({ success: true })
})

app.delete('/api/users/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM attendance_records WHERE user_id = ?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM requests WHERE user_id = ?').bind(id).run()
  return c.json({ success: true })
})

// --- Records API ---

app.get('/api/records-all', async (c) => {
  const { month } = c.req.query() // YYYY-MM
  
  let query = 'SELECT * FROM attendance_records'
  let params: string[] = []
  
  if (month) {
    query += ' WHERE date LIKE ?'
    params.push(`${month}-%`)
  }
  
  const { results } = await c.env.DB.prepare(query).bind(...params).all()
  
  // キャメルケースに変換して返す
  const formattedResults = results.map(r => ({
    id: String(r.id),
    userId: r.user_id,
    date: r.date,
    clockIn: r.clock_in,
    clockOut: r.clock_out,
    breakStart: r.break_start,
    breakEnd: r.break_end,
    memo: r.memo || '',
    isHolidayWork: Boolean(r.is_holiday_work),
  }))
  
  return c.json(formattedResults)
})

app.get('/api/records/:userId', async (c) => {
  const userId = c.req.param('userId')
  const { month } = c.req.query() // YYYY-MM
  
  let query = 'SELECT * FROM attendance_records WHERE user_id = ?'
  let params: string[] = [userId]
  
  if (month) {
    query += ' AND date LIKE ?'
    params.push(`${month}-%`)
  }
  
  const { results } = await c.env.DB.prepare(query).bind(...params).all()
  
  // キャメルケースに変換して返す
  const formattedResults = results.map(r => ({
    id: String(r.id),
    userId: r.user_id,
    date: r.date,
    clockIn: r.clock_in,
    clockOut: r.clock_out,
    breakStart: r.break_start,
    breakEnd: r.break_end,
    memo: r.memo || '',
    isHolidayWork: Boolean(r.is_holiday_work),
  }))
  
  return c.json(formattedResults)
})

app.post('/api/clock-in', async (c) => {
  const { userId, date, time, isHolidayWork, memo } = await c.req.json()
  
  // すでに出勤打刻があるか確認（上書き防止）
  const existing = await c.env.DB.prepare('SELECT clock_in, memo FROM attendance_records WHERE user_id = ? AND date = ?')
    .bind(userId, date).first<{ clock_in: string | null; memo: string | null }>()

  if (existing && existing.clock_in) {
    return c.json({ success: true, message: 'Already clocked in' })
  }

  const isHoliday = Boolean(isHolidayWork) || isNonWorkingDay(date)
  let initialMemo = existing?.memo || ''
  if (memo && memo.trim()) {
    initialMemo = initialMemo ? `${initialMemo} / ${memo.trim()}` : memo.trim()
  }

  const query = `
    INSERT INTO attendance_records (user_id, date, clock_in, memo, is_holiday_work) 
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, date) DO UPDATE SET 
      clock_in = COALESCE(attendance_records.clock_in, excluded.clock_in),
      memo = CASE WHEN excluded.memo != '' THEN excluded.memo ELSE attendance_records.memo END,
      is_holiday_work = excluded.is_holiday_work
  `
  await c.env.DB.prepare(query).bind(userId, date, time, initialMemo, isHoliday ? 1 : 0).run()

  // 所属グループへの出勤通知
  const user = await c.env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(userId).first<{ name: string }>()
  if (user) {
    const d = new Date(time)
    const jstD = new Date(d.getTime() + (9 * 60 * 60 * 1000))
    const timeDisplay = `${String(jstD.getUTCHours()).padStart(2, '0')}:${String(jstD.getUTCMinutes()).padStart(2, '0')}`
    await notifyGroupAttendance(c.env.DB, userId, user.name, '出勤', timeDisplay, c.env.LINE_CHANNEL_ACCESS_TOKEN)
  }

  return c.json({ success: true })
})

app.post('/api/clock-out', async (c) => {
  const { userId, date, time, memo } = await c.req.json()
  
  // すでに退勤打刻があるか確認
  const existing = await c.env.DB.prepare('SELECT clock_out, memo FROM attendance_records WHERE user_id = ? AND date = ?')
    .bind(userId, date).first<{ clock_out: string | null; memo: string | null }>()

  if (existing && existing.clock_out) {
    return c.json({ success: true, message: 'Already clocked out' })
  }

  let finalMemo = existing?.memo || ''
  if (memo && memo.trim()) {
    finalMemo = finalMemo ? `${finalMemo} / ${memo.trim()}` : memo.trim()
  }

  const query = `
    UPDATE attendance_records SET clock_out = ?, memo = ? WHERE user_id = ? AND date = ?
  `
  await c.env.DB.prepare(query).bind(time, finalMemo, userId, date).run()

  // 所属グループへの退勤通知
  const user = await c.env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(userId).first<{ name: string }>()
  if (user) {
    const d = new Date(time)
    const jstD = new Date(d.getTime() + (9 * 60 * 60 * 1000))
    const timeDisplay = `${String(jstD.getUTCHours()).padStart(2, '0')}:${String(jstD.getUTCMinutes()).padStart(2, '0')}`
    await notifyGroupAttendance(c.env.DB, userId, user.name, '退勤', timeDisplay, c.env.LINE_CHANNEL_ACCESS_TOKEN)
  }

  return c.json({ success: true })
})

app.post('/api/migrate-holiday-work', async (c) => {
  const { results: records } = await c.env.DB.prepare('SELECT id, date, is_holiday_work FROM attendance_records').all<{ id: number; date: string; is_holiday_work: number }>()
  let updatedCount = 0
  for (const r of (records || [])) {
    const isHoliday = isNonWorkingDay(r.date) ? 1 : 0
    if (r.is_holiday_work !== isHoliday) {
      await c.env.DB.prepare('UPDATE attendance_records SET is_holiday_work = ? WHERE id = ?').bind(isHoliday, r.id).run()
      updatedCount++
    }
  }
  return c.json({ success: true, updatedCount, totalChecked: records.length })
})

app.post('/api/break-start', async (c) => {
  const { userId, date, time } = await c.req.json()
  const query = `
    UPDATE attendance_records SET break_start = COALESCE(break_start, ?) 
    WHERE user_id = ? AND date = ?
  `
  await c.env.DB.prepare(query).bind(time, userId, date).run()
  return c.json({ success: true })
})

app.post('/api/break-end', async (c) => {
  const { userId, date, time } = await c.req.json()
  const query = `
    UPDATE attendance_records SET break_end = COALESCE(break_end, ?) 
    WHERE user_id = ? AND date = ?
  `
  await c.env.DB.prepare(query).bind(time, userId, date).run()
  return c.json({ success: true })
})

app.post('/api/memo', async (c) => {
  const { userId, date, memo } = await c.req.json()
  const query = `
    INSERT INTO attendance_records (user_id, date, memo) VALUES (?, ?, ?)
    ON CONFLICT(user_id, date) DO UPDATE SET memo = excluded.memo
  `
  await c.env.DB.prepare(query).bind(userId, date, memo).run()
  return c.json({ success: true })
})

app.post('/api/schedule', async (c) => {
  // 簡易的にメモとして保存する（将来的にrecordTypeカラムを追加予定）
  const { userId, date, recordType, memo } = await c.req.json()
  const fullMemo = `[${recordType}] ${memo}`
  const query = `
    INSERT INTO attendance_records (user_id, date, memo) VALUES (?, ?, ?)
    ON CONFLICT(user_id, date) DO UPDATE SET memo = excluded.memo
  `
  await c.env.DB.prepare(query).bind(userId, date, fullMemo).run()
  return c.json({ success: true })
})

app.put('/api/records/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const query = `
    UPDATE attendance_records
    SET clock_in = ?, clock_out = ?, break_start = ?, break_end = ?, memo = ?
    WHERE id = ?
  `
  await c.env.DB.prepare(query).bind(
    body.clockIn || null,
    body.clockOut || null,
    body.breakStart || null,
    body.breakEnd || null,
    body.memo || '',
    id
  ).run()
  return c.json({ success: true })
})

app.delete('/api/records/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM attendance_records WHERE id = ?').bind(id).run()
  return c.json({ success: true })
})

app.post('/api/records', async (c) => {
  const body = await c.req.json()
  const isHoliday = Boolean(body.isHolidayWork) || isNonWorkingDay(body.date)
  const query = `
    INSERT INTO attendance_records (user_id, date, clock_in, clock_out, break_start, break_end, memo, is_holiday_work)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, date) DO UPDATE SET
      clock_in = excluded.clock_in,
      clock_out = excluded.clock_out,
      break_start = excluded.break_start,
      break_end = excluded.break_end,
      memo = excluded.memo,
      is_holiday_work = excluded.is_holiday_work
  `
  await c.env.DB.prepare(query).bind(
    body.userId,
    body.date,
    body.clockIn || null,
    body.clockOut || null,
    body.breakStart || null,
    body.breakEnd || null,
    body.memo || '',
    isHoliday ? 1 : 0
  ).run()
  return c.json({ success: true })
})

app.post('/api/login-line', async (c) => {
  const { lineUserId, displayName } = await c.req.json()
  let user = await c.env.DB.prepare('SELECT id, name, role FROM users WHERE line_user_id = ?').bind(lineUserId).first<{id: string, name: string, role: string}>()
  
  if (!user) {
    const newUserId = 'u_' + Math.random().toString(36).substring(2, 9)
    const initialName = displayName && displayName !== 'LINE ユーザー' ? displayName : '新規ユーザー'
    await c.env.DB.prepare('INSERT INTO users (id, name, line_user_id) VALUES (?, ?, ?)')
      .bind(newUserId, initialName, lineUserId)
      .run()
    user = { id: newUserId, name: initialName, role: 'employee' }
  } else if (displayName && displayName !== 'LINE ユーザー' && (user.name === '新規ユーザー' || user.name === 'LINE ユーザー')) {
    await c.env.DB.prepare('UPDATE users SET name = ? WHERE id = ?').bind(displayName, user.id).run()
    user.name = displayName
  }
  
  return c.json(user)
})

// --- Compensatory Balance API (振替休暇残高) ---

app.get('/api/users/:userId/compensatory-balance', async (c) => {
  const userId = c.req.param('userId')
  const balance = await getUserCompensatoryBalance(c.env.DB, userId)
  return c.json(balance)
})

app.get('/api/compensatory-balances', async (c) => {
  const { results: users } = await c.env.DB.prepare("SELECT id, name FROM users WHERE role = 'employee'").all<{ id: string; name: string }>()
  const balances: Record<string, any> = {}
  for (const u of users) {
    balances[u.id] = await getUserCompensatoryBalance(c.env.DB, u.id)
  }
  return c.json(balances)
})

// --- 勤怠サマリーをLINEへ送信するAPI ---
app.post('/api/send-summary-line', async (c) => {
  const { targetUserId, month, adminLineUserId } = await c.req.json()
  
  const user = await c.env.DB.prepare('SELECT id, name FROM users WHERE id = ?').bind(targetUserId).first<{ id: string, name: string }>()
  if (!user) {
    return c.json({ error: 'User not found' }, 404)
  }

  const { results: records } = await c.env.DB.prepare(
    'SELECT * FROM attendance_records WHERE user_id = ? AND date LIKE ? ORDER BY date ASC'
  ).bind(targetUserId, `${month}-%`).all<DBAttendanceRecord>()

  const compBalance = await getUserCompensatoryBalance(c.env.DB, targetUserId)

  let totalMinutes = 0
  let overtimeMinutes = 0
  let workDays = 0

  const lines: string[] = []
  const weekDayNames = ['日', '月', '火', '水', '木', '金', '土']

  for (const r of (records || [])) {
    if (r.clock_in && r.clock_out) {
      workDays++
      const cin = new Date(r.clock_in).getTime()
      const cout = new Date(r.clock_out).getTime()
      const stayMin = Math.max(0, Math.floor((cout - cin) / 60000))
      const autoBreak = stayMin > 360 ? 60 : 0
      const workedMin = Math.max(0, stayMin - autoBreak)
      totalMinutes += workedMin
      if (workedMin > 480) {
        overtimeMinutes += (workedMin - 480)
      }

      const d = new Date(r.date)
      const dow = isNaN(d.getDay()) ? '' : `(${weekDayNames[d.getDay()]})`
      
      const inJst = new Date(new Date(r.clock_in).getTime() + (9 * 60 * 60 * 1000))
      const inStr = `${String(inJst.getUTCHours()).padStart(2, '0')}:${String(inJst.getUTCMinutes()).padStart(2, '0')}`
      const outJst = new Date(new Date(r.clock_out).getTime() + (9 * 60 * 60 * 1000))
      const outStr = `${String(outJst.getUTCHours()).padStart(2, '0')}:${String(outJst.getUTCMinutes()).padStart(2, '0')}`

      const wh = Math.floor(workedMin / 60)
      const wm = workedMin % 60
      const workTimeStr = wm > 0 ? `${wh}h${wm}m` : `${wh}h`
      const holidayMark = r.is_holiday_work ? ' [休出]' : ''
      const memoText = r.memo ? ` (${r.memo})` : ''

      lines.push(`${r.date.substring(5)} ${dow} ${inStr}〜${outStr} [${workTimeStr}]${holidayMark}${memoText}`)
    }
  }

  const totalHours = (totalMinutes / 60).toFixed(1)
  const otHours = (overtimeMinutes / 60).toFixed(1)

  const origin = new URL(c.req.url).origin
  const downloadUrl = `${origin}/api/download-csv?userId=${targetUserId}&month=${month}`

  let pushText = `📊【出勤サマリー (${month})】\n`
  pushText += `従業員: ${user.name} 様\n`
  pushText += `━━━━━━━━━━━━━━\n`
  pushText += `・総労働時間: ${totalHours}時間\n`
  pushText += `・残業時間: ${otHours}時間\n`
  pushText += `・出勤日数: ${workDays}日\n`
  pushText += `・振替残高: ${compBalance.displayTime}\n`
  pushText += `━━━━━━━━━━━━━━\n`
  if (lines.length > 0) {
    pushText += `【日別打刻】\n` + lines.join('\n') + `\n\n`
  } else {
    pushText += `当月の出退勤記録はありません。\n\n`
  }
  pushText += `📁 CSVダウンロード:\n${downloadUrl}`

  const accessToken = c.env.LINE_CHANNEL_ACCESS_TOKEN
  if (accessToken) {
    if (adminLineUserId) {
      await pushMessage(adminLineUserId, pushText, accessToken)
    } else {
      const { results: admins } = await c.env.DB.prepare(
        "SELECT line_user_id FROM users WHERE role = 'admin' AND line_user_id IS NOT NULL"
      ).all<{ line_user_id: string }>()
      for (const a of (admins || [])) {
        if (a.line_user_id) {
          await pushMessage(a.line_user_id, pushText, accessToken)
        }
      }
    }
  }

  return c.json({ success: true })
})

// --- CSV直接ダウンロードAPI ---
app.get('/api/download-csv', async (c) => {
  const { userId, month } = c.req.query()
  if (!userId || !month) {
    return c.text('Missing userId or month', 400)
  }

  const user = await c.env.DB.prepare('SELECT id, name FROM users WHERE id = ?').bind(userId).first<{ id: string, name: string }>()
  if (!user) {
    return c.text('User not found', 404)
  }

  const { results: records } = await c.env.DB.prepare(
    'SELECT * FROM attendance_records WHERE user_id = ? AND date LIKE ? ORDER BY date ASC'
  ).bind(userId, `${month}-%`).all<DBAttendanceRecord>()

  const compBalance = await getUserCompensatoryBalance(c.env.DB, userId)

  const [y, m] = month.split('-').map(Number)
  const lastDay = new Date(y, m, 0).getDate()
  const weekDayNames = ['日', '月', '火', '水', '木', '金', '土']

  let totalMinutes = 0
  let overtimeMinutes = 0
  let workDays = 0

  const dayRows: string[] = []

  for (let d = 1; d <= lastDay; d++) {
    const dayStr = String(d).padStart(2, '0')
    const dateStr = `${month}-${dayStr}`
    const dt = new Date(y, m - 1, d)
    const dowStr = weekDayNames[dt.getDay()]

    const rec = (records || []).find((r: any) => r.date === dateStr)

    let kbn = ''
    let inStr = ''
    let outStr = ''
    let breakStr = ''
    let workStr = ''
    let memoStr = rec?.memo || ''

    if (rec) {
      if (rec.is_holiday_work) kbn = '休日出勤'
      else if (rec.clock_in) kbn = '出勤'

      if (rec.clock_in) {
        const inJst = new Date(new Date(rec.clock_in).getTime() + (9 * 60 * 60 * 1000))
        inStr = `${String(inJst.getUTCHours()).padStart(2, '0')}:${String(inJst.getUTCMinutes()).padStart(2, '0')}`
      }
      if (rec.clock_out) {
        const outJst = new Date(new Date(rec.clock_out).getTime() + (9 * 60 * 60 * 1000))
        outStr = `${String(outJst.getUTCHours()).padStart(2, '0')}:${String(outJst.getUTCMinutes()).padStart(2, '0')}`
      }

      if (rec.clock_in && rec.clock_out) {
        workDays++
        const cin = new Date(rec.clock_in).getTime()
        const cout = new Date(rec.clock_out).getTime()
        const stayMin = Math.max(0, Math.floor((cout - cin) / 60000))
        const autoBreak = stayMin > 360 ? 60 : 0
        const workedMin = Math.max(0, stayMin - autoBreak)
        totalMinutes += workedMin
        if (workedMin > 480) overtimeMinutes += (workedMin - 480)

        breakStr = autoBreak > 0 ? `${autoBreak}分` : '0分'
        const wh = Math.floor(workedMin / 60)
        const wm = workedMin % 60
        workStr = `${wh}:${String(wm).padStart(2, '0')}`
      }
    }

    const cleanMemo = `"${memoStr.replace(/"/g, '""')}"`
    dayRows.push(`${dateStr},${dowStr},${kbn},${inStr},${outStr},${breakStr},${workStr},${cleanMemo}`)
  }

  const totalHours = (totalMinutes / 60).toFixed(1)
  const otHours = (overtimeMinutes / 60).toFixed(1)

  let csv = '\uFEFF' // BOM
  csv += `出勤サマリー (${month})\n`
  csv += `氏名,${user.name}\n`
  csv += `総労働時間,${totalHours}時間\n`
  csv += `残業時間,${otHours}時間\n`
  csv += `出勤日数,${workDays}日\n`
  csv += `振替休暇残高,${compBalance.displayTime}\n\n`
  csv += `日付,曜日,区分,出勤時刻,退勤時刻,休憩,労働時間,備考\n`
  csv += dayRows.join('\n')

  const fileName = encodeURIComponent(`勤怠サマリー_${user.name}_${month}.csv`)
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName}"; filename*=UTF-8''${fileName}`,
    }
  })
})

// --- Requests API (申請・承認管理) ---

app.get('/api/requests', async (c) => {
  const { userId, status } = c.req.query()
  
  let query = `
    SELECT r.*, u.name as user_name
    FROM requests r
    LEFT JOIN users u ON r.user_id = u.id
    WHERE 1=1
  `
  const params: string[] = []
  
  if (userId) {
    query += ' AND r.user_id = ?'
    params.push(userId)
  }
  if (status) {
    query += ' AND r.status = ?'
    params.push(status)
  }
  query += ' ORDER BY r.created_at DESC'
  
  const { results } = await c.env.DB.prepare(query).bind(...params).all()
  
  const formatted = results.map(r => ({
    id: String(r.id),
    userId: r.user_id,
    userName: r.user_name || '未設定',
    type: r.type,
    leaveType: r.leave_type || undefined,
    date: r.date,
    substituteMinutes: r.substitute_minutes || 0,
    substituteAction: r.substitute_action || undefined,
    clockIn: r.clock_in,
    clockOut: r.clock_out,
    breakStart: r.break_start,
    breakEnd: r.break_end,
    reason: r.reason,
    status: r.status,
    rejectionReason: r.rejection_reason,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }))
  
  return c.json(formatted)
})

app.post('/api/requests', async (c) => {
  const body = await c.req.json()
  const {
    userId,
    type,
    leaveType,
    date,
    substituteMinutes,
    substituteAction,
    clockIn,
    clockOut,
    breakStart,
    breakEnd,
    reason
  } = body

  if (!userId || !type || !date) {
    return c.json({ error: '必須項目が不足しています' }, 400)
  }

  const trimmedReason = (reason || '').trim()
  if (!trimmedReason) {
    return c.json({ error: '申請理由を入力してください（コメント必須）' }, 400)
  }

  let finalSubstituteMinutes = Number(substituteMinutes) || 0

  // 1. 振替休暇全休（8時間分貯まれば1日まるまる休暇）のチェック
  if (type === 'leave' && leaveType === 'substitute' && substituteAction === 'full_off') {
    const balance = await getUserCompensatoryBalance(c.env.DB, userId)
    if (balance.remainingMinutes < 480) {
      return c.json({ error: `全日振替休暇には8時間（480分）以上の残高が必要です（現在の残高: ${balance.displayTime}）` }, 400)
    }
    finalSubstituteMinutes = 480
  }

  // 2. 当日の早上がり申請の時刻制限チェック
  // 例: 30分早上がり（予定17:30）の場合、17:30より前ならOK、17:30以降は不可
  if (type === 'leave' && substituteAction === 'early_leave') {
    const now = new Date()
    const jstDate = new Date(now.getTime() + (9 * 60 * 60 * 1000))
    const todayJstStr = jstDate.toISOString().split('T')[0]
    if (date === todayJstStr) {
      const subMin = finalSubstituteMinutes > 0 ? finalSubstituteMinutes : 30
      const scheduledOutMinutes = 18 * 60 - subMin // 例: 30分早上がりなら 17:30 = 1050分
      const currentJstMinutes = jstDate.getUTCHours() * 60 + jstDate.getUTCMinutes()
      if (currentJstMinutes >= scheduledOutMinutes) {
        const h = String(Math.floor(scheduledOutMinutes / 60)).padStart(2, '0')
        const m = String(scheduledOutMinutes % 60).padStart(2, '0')
        return c.json({ error: `当日の早上がり申請は、早上がり予定時刻（${h}:${m}）より前に行う必要があります。` }, 400)
      }
    }
  }

  const query = `
    INSERT INTO requests (
      user_id, type, leave_type, date, substitute_minutes, substitute_action,
      clock_in, clock_out, break_start, break_end, reason, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `
  const res = await c.env.DB.prepare(query).bind(
    userId,
    type,
    leaveType || null,
    date,
    finalSubstituteMinutes,
    substituteAction || null,
    clockIn || null,
    clockOut || null,
    breakStart || null,
    breakEnd || null,
    trimmedReason
  ).run()

  // 申請通知の送信
  const user = await c.env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(userId).first<{ name: string }>()
  const userName = user ? user.name : '従業員'
  
  let typeTitle = '休暇申請'
  let detailsText = ''
  if (type === 'clock_correction') {
    typeTitle = '打刻修正申請'
    detailsText = `出勤: ${formatTimeSimple(clockIn)}, 退勤: ${formatTimeSimple(clockOut)}`
  } else {
    if (leaveType === 'paid') {
      typeTitle = '有給休暇申請'
      detailsText = '全日有給休暇'
    } else if (leaveType === 'substitute') {
      typeTitle = '振替休暇申請'
      const actionMap: Record<string, string> = { early_leave: '早退', late_arrive: '遅出', full_off: '全休' }
      const actionName = substituteAction ? (actionMap[substituteAction] || substituteAction) : '短縮'
      detailsText = `${actionName} (${substituteMinutes}分消化)`
    } else if (leaveType === 'absence') {
      typeTitle = '欠勤申請'
      detailsText = '欠勤'
    }
  }

  await notifyAdminsNewRequest(
    c.env.DB,
    userName,
    typeTitle,
    date,
    reason,
    detailsText,
    c.env.LINE_CHANNEL_ACCESS_TOKEN
  )

  return c.json({ success: true, id: res.meta.last_row_id })
})

app.put('/api/requests/:id/approve', async (c) => {
  const id = c.req.param('id')
  
  const req = await c.env.DB.prepare('SELECT * FROM requests WHERE id = ?').bind(id).first<DBRequest>()
  if (!req) {
    return c.json({ error: 'Request not found' }, 404)
  }

  // ステータスをapprovedに更新
  await c.env.DB.prepare("UPDATE requests SET status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(id).run()

  // 勤怠レコードへの反映
  if (req.type === 'clock_correction') {
    const updateQuery = `
      INSERT INTO attendance_records (user_id, date, clock_in, clock_out, break_start, break_end, memo)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, date) DO UPDATE SET
        clock_in = excluded.clock_in,
        clock_out = excluded.clock_out,
        break_start = excluded.break_start,
        break_end = excluded.break_end,
        memo = excluded.memo
    `
    const correctionMemo = req.reason ? `[修正承認] ${req.reason}` : '[修正承認]'
    await c.env.DB.prepare(updateQuery).bind(
      req.user_id,
      req.date,
      req.clock_in || null,
      req.clock_out || null,
      req.break_start || null,
      req.break_end || null,
      correctionMemo
    ).run()
  } else if (req.type === 'leave') {
    let leaveTag = ''
    if (req.leave_type === 'paid') {
      leaveTag = `[有給] ${req.reason}`
    } else if (req.leave_type === 'substitute') {
      const actionMap: Record<string, string> = { early_leave: '早退', late_arrive: '遅出', full_off: '全休' }
      const actionName = req.substitute_action ? (actionMap[req.substitute_action] || req.substitute_action) : '短縮'
      leaveTag = `[振替休(${actionName} ${req.substitute_minutes}分)] ${req.reason}`
    } else if (req.leave_type === 'absence') {
      leaveTag = `[欠勤] ${req.reason}`
    }

    const updateMemoQuery = `
      INSERT INTO attendance_records (user_id, date, memo)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, date) DO UPDATE SET
        memo = CASE WHEN attendance_records.memo IS NULL OR attendance_records.memo = '' THEN excluded.memo ELSE attendance_records.memo || ' / ' || excluded.memo END
    `
    await c.env.DB.prepare(updateMemoQuery).bind(req.user_id, req.date, leaveTag).run()
  }

  // 申請者へのPush通知
  let typeTitle = req.type === 'clock_correction' ? '打刻修正申請' : (req.leave_type === 'paid' ? '有給休暇申請' : (req.leave_type === 'substitute' ? '振替休暇申請' : '欠勤申請'))
  await notifyUserRequestResult(
    c.env.DB,
    req.user_id,
    '承認',
    typeTitle,
    req.date,
    undefined,
    c.env.LINE_CHANNEL_ACCESS_TOKEN
  )

  return c.json({ success: true })
})

app.put('/api/requests/:id/reject', async (c) => {
  const id = c.req.param('id')
  const { reason } = await c.req.json()

  const req = await c.env.DB.prepare('SELECT * FROM requests WHERE id = ?').bind(id).first<DBRequest>()
  if (!req) {
    return c.json({ error: 'Request not found' }, 404)
  }

  await c.env.DB.prepare("UPDATE requests SET status = 'rejected', rejection_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(reason || '管理者により却下されました', id).run()

  let typeTitle = req.type === 'clock_correction' ? '打刻修正申請' : (req.leave_type === 'paid' ? '有給休暇申請' : (req.leave_type === 'substitute' ? '振替休暇申請' : '欠勤申請'))
  await notifyUserRequestResult(
    c.env.DB,
    req.user_id,
    '却下',
    typeTitle,
    req.date,
    reason || '管理者により却下されました',
    c.env.LINE_CHANNEL_ACCESS_TOKEN
  )

  return c.json({ success: true })
})

app.delete('/api/requests/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare("DELETE FROM requests WHERE id = ? AND status = 'pending'").bind(id).run()
  return c.json({ success: true })
})

// --- Calendar Events & Company Schedule API ---

app.get('/api/calendar-events', async (c) => {
  const { month } = c.req.query()
  await c.env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS calendar_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      title TEXT NOT NULL,
      user_id TEXT,
      user_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run()

  let query = 'SELECT * FROM calendar_events'
  let params: string[] = []
  if (month) {
    query += ' WHERE date LIKE ? ORDER BY date ASC, id ASC'
    params.push(`${month}-%`)
  } else {
    query += ' ORDER BY date ASC, id ASC'
  }

  const { results } = await c.env.DB.prepare(query).bind(...params).all()
  const formatted = (results || []).map(r => ({
    id: String(r.id),
    date: r.date,
    title: r.title,
    userId: r.user_id,
    userName: r.user_name || '社内',
    createdAt: r.created_at
  }))
  return c.json(formatted)
})

app.post('/api/calendar-events', async (c) => {
  const { date, title, userId, userName } = await c.req.json()
  if (!date || !title || !title.trim()) {
    return c.json({ error: '日付とタイトルを入力してください' }, 400)
  }

  await c.env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS calendar_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      title TEXT NOT NULL,
      user_id TEXT,
      user_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run()

  const res = await c.env.DB.prepare(
    'INSERT INTO calendar_events (date, title, user_id, user_name) VALUES (?, ?, ?, ?)'
  ).bind(date, title.trim(), userId || null, userName || '社内').run()

  return c.json({ success: true, id: String(res.meta.last_row_id) })
})

app.delete('/api/calendar-events/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM calendar_events WHERE id = ?').bind(id).run()
  return c.json({ success: true })
})

app.get('/api/company-schedule', async (c) => {
  const { month } = c.req.query() // YYYY-MM
  if (!month) {
    return c.json({ error: 'Month is required' }, 400)
  }

  await c.env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS calendar_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      title TEXT NOT NULL,
      user_id TEXT,
      user_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run()

  // 1. 社内カレンダーイベント取得
  const { results: events } = await c.env.DB.prepare(
    'SELECT * FROM calendar_events WHERE date LIKE ? ORDER BY date ASC, id ASC'
  ).bind(`${month}-%`).all()

  // 2. 指定月の全従業員の休暇・短縮申請（承認済み・申請中）を取得
  const { results: requests } = await c.env.DB.prepare(`
    SELECT r.*, u.name as user_name
    FROM requests r
    JOIN users u ON r.user_id = u.id
    WHERE r.date LIKE ? AND r.status IN ('pending', 'approved') AND r.type = 'leave'
    ORDER BY r.date ASC
  `).bind(`${month}-%`).all()

  return c.json({
    events: (events || []).map(r => ({
      id: String(r.id),
      date: r.date,
      title: r.title,
      userId: r.user_id,
      userName: r.user_name || '社内',
      createdAt: r.created_at
    })),
    leaves: (requests || []).map(r => ({
      id: String(r.id),
      userId: r.user_id,
      userName: r.user_name,
      date: r.date,
      leaveType: r.leave_type, // paid, substitute, absence
      substituteAction: r.substitute_action, // early_leave, late_arrive, full_off
      substituteMinutes: r.substitute_minutes || 0,
      status: r.status // pending, approved
    }))
  })
})

// --- LINE Groups & User Groups API ---

app.get('/api/groups', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT id, name, updated_at FROM line_groups ORDER BY updated_at DESC').all<{ id: string; name: string; updated_at: string }>()
  const groups = results || []

  // 名前が 'グループ' のままのものがあれば、LINE API からグループ名を取得して自動更新
  const accessToken = c.env.LINE_CHANNEL_ACCESS_TOKEN
  if (accessToken) {
    for (const g of groups) {
      if (!g.name || g.name === 'グループ') {
        const summary = await getLineGroupSummary(g.id, accessToken)
        if (summary.groupName) {
          g.name = summary.groupName
          await c.env.DB.prepare('UPDATE line_groups SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .bind(summary.groupName, g.id).run().catch(() => {})
        }
      }
    }
  }

  return c.json(groups)
})

app.get('/api/user-groups', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT user_id, group_id FROM user_groups').all<{ user_id: string; group_id: string }>()
  return c.json(results || [])
})

app.put('/api/users/:id/groups', async (c) => {
  const userId = c.req.param('id')
  const { groupIds } = await c.req.json<{ groupIds: string[] }>()

  if (!Array.isArray(groupIds)) {
    return c.json({ error: 'groupIds must be an array' }, 400)
  }

  // 既存の紐付けを一度削除して再登録
  await c.env.DB.prepare('DELETE FROM user_groups WHERE user_id = ?').bind(userId).run()

  for (const gid of groupIds) {
    await c.env.DB.prepare(`
      INSERT INTO user_groups (user_id, group_id, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, group_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
    `).bind(userId, gid).run()
  }

  return c.json({ success: true })
})

// --- 内部ヘルパー型・関数 ---

interface DBAttendanceRecord {
  id: number
  user_id: string
  date: string
  clock_in: string | null
  clock_out: string | null
  break_start: string | null
  break_end: string | null
  memo: string | null
  is_holiday_work: number
}

interface DBRequest {
  id: number
  user_id: string
  type: string
  leave_type: string | null
  date: string
  substitute_minutes: number
  substitute_action: string | null
  clock_in: string | null
  clock_out: string | null
  break_start: string | null
  break_end: string | null
  reason: string
  status: string
  rejection_reason: string | null
  created_at: string
  updated_at: string
  user_name?: string
}

function formatTimeSimple(isoStr?: string | null): string {
  if (!isoStr) return '-'
  try {
    const d = new Date(isoStr)
    const jstD = new Date(d.getTime() + (9 * 60 * 60 * 1000))
    const h = String(jstD.getUTCHours()).padStart(2, '0')
    const m = String(jstD.getUTCMinutes()).padStart(2, '0')
    return `${h}:${m}`
  } catch {
    return '-'
  }
}

function calculateCompensatoryGrantedMinutes(r: DBAttendanceRecord): number {
  if (!r.clock_in || !r.clock_out) return 0
  const clockIn = new Date(r.clock_in).getTime()
  const clockOut = new Date(r.clock_out).getTime()
  const stayMinutes = Math.max(0, Math.floor((clockOut - clockIn) / 60000))
  
  // 6時間超で60分自動休憩
  const breakMinutes = stayMinutes > 360 ? 60 : 0
  const workedMinutes = Math.max(0, stayMinutes - breakMinutes)

  const isHoliday = Boolean(r.is_holiday_work) || isNonWorkingDay(r.date)
  if (isHoliday) {
    // 休日出勤: 労働時間を見て30分単位で付与（50分働いても30分付与）
    return Math.floor(workedMinutes / 30) * 30
  } else {
    // 平日: 9:00-18:00が所定労働時間。遅刻・早退の時間ペナルティは無し。
    const inD = new Date(r.clock_in)
    const inJst = new Date(inD.getTime() + (9 * 60 * 60 * 1000))
    const totalInMinutes = inJst.getUTCHours() * 60 + inJst.getUTCMinutes()

    const outD = new Date(r.clock_out)
    const outJst = new Date(outD.getTime() + (9 * 60 * 60 * 1000))
    const totalOutMinutes = outJst.getUTCHours() * 60 + outJst.getUTCMinutes()

    // 1. 早出分（9:00前）: 9:00 = 540分。30分単位で切り捨てて付与（8:20出勤で30分付与、8:40出勤で0分付与）
    const earlyMinutes = Math.max(0, 540 - totalInMinutes)
    const earlyGranted = Math.floor(earlyMinutes / 30) * 30

    // 2. 残業分（18:00後）: 18:00 = 1080分。30分単位で切り捨てて付与（18:30退勤で30分付与、18:20退勤で0分付与）
    const overtimeMinutes = Math.max(0, totalOutMinutes - 1080)
    const overtimeGranted = Math.floor(overtimeMinutes / 30) * 30

    return earlyGranted + overtimeGranted
  }
}

async function getUserCompensatoryBalance(db: D1Database, userId: string) {
  // 1. 全勤怠レコードの取得
  const { results: records } = await db.prepare(
    'SELECT * FROM attendance_records WHERE user_id = ?'
  ).bind(userId).all<DBAttendanceRecord>()

  let grantedMinutes = 0
  for (const r of (records || [])) {
    grantedMinutes += calculateCompensatoryGrantedMinutes(r)
  }

  // 2. 承認済み振替休暇申請（消化分）の取得
  const { results: requests } = await db.prepare(
    "SELECT substitute_minutes FROM requests WHERE user_id = ? AND type = 'leave' AND leave_type = 'substitute' AND status = 'approved'"
  ).bind(userId).all<{ substitute_minutes: number }>()

  let usedMinutes = 0
  for (const req of (requests || [])) {
    usedMinutes += (req.substitute_minutes || 0)
  }

  const remainingMinutes = Math.max(0, grantedMinutes - usedMinutes)
  const h = Math.floor(remainingMinutes / 60)
  const m = remainingMinutes % 60
  const displayTime = h > 0 ? (m > 0 ? `${h}時間${m}分` : `${h}時間`) : `${m}分`

  return {
    grantedMinutes,
    usedMinutes,
    remainingMinutes,
    displayTime
  }
}

async function notifyAdminsNewRequest(
  db: D1Database,
  userName: string,
  requestType: string,
  date: string,
  reason: string,
  detailsText: string,
  accessToken?: string
) {
  if (!accessToken) return
  try {
    const pushText = `【勤怠申請】\n${userName}さんから${requestType}の申請が届きました。\n対象日: ${date}\n内容: ${detailsText}\n理由: ${reason}\n管理画面から確認・承認してください。`
    
    // 管理者ユーザー（個人LINE）にのみ通知
    const { results: admins } = await db.prepare(
      "SELECT line_user_id FROM users WHERE role = 'admin' AND line_user_id IS NOT NULL"
    ).all<{ line_user_id: string }>()

    for (const a of (admins || [])) {
      if (a.line_user_id) {
        await pushMessage(a.line_user_id, pushText, accessToken)
      }
    }
  } catch (e) {
    console.error('notifyAdminsNewRequest error:', e)
  }
}

async function notifyUserRequestResult(
  db: D1Database,
  userId: string,
  status: '承認' | '却下',
  requestType: string,
  date: string,
  rejectionReason?: string,
  accessToken?: string
) {
  if (!accessToken) return
  try {
    const user = await db.prepare('SELECT name, line_user_id FROM users WHERE id = ?').bind(userId).first<{ name: string; line_user_id: string | null }>()
    if (!user || !user.line_user_id) return

    let pushText = `【申請${status}】\n${user.name}様\n${date}の${requestType}が「${status}」されました。`
    if (status === '却下' && rejectionReason) {
      pushText += `\n却下理由: ${rejectionReason}`
    }

    await pushMessage(user.line_user_id, pushText, accessToken)
  } catch (e) {
    console.error('notifyUserRequestResult error:', e)
  }
}

// --- LINE Webhook ---


// WebCryptoによる署名検証
async function verifySignature(signature: string, body: string, channelSecret: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(channelSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(body))
  const signatureBase64 = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)))
  return signature === signatureBase64
}

// 簡易Reply関数
async function replyMessage(replyToken: string, text: string, accessToken: string) {
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    },
    body: JSON.stringify({
      replyToken: replyToken,
      messages: [{ type: 'text', text: text }]
    })
  })
}

// 簡易Push関数（成否とステータスを返す）
async function pushMessage(to: string, text: string, accessToken: string): Promise<{ success: boolean; status?: number; error?: string }> {
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        to: to,
        messages: [{ type: 'text', text: text }]
      })
    })
    if (!res.ok) {
      const errBody = await res.text()
      console.error(`Push failed for ${to}: status=${res.status}, body=${errBody}`)
      return { success: false, status: res.status, error: errBody }
    }
    console.log(`Push success for ${to}`)
    return { success: true, status: 200 }
  } catch (e: any) {
    console.error('Push error:', e)
    return { success: false, error: e?.message || String(e) }
  }
}

// LINEグループ情報の取得（グループ名取得）
async function getLineGroupSummary(groupId: string, accessToken: string): Promise<{ groupName?: string }> {
  try {
    const res = await fetch(`https://api.line.me/v2/bot/group/${groupId}/summary`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    })
    if (res.ok) {
      const data = await res.json() as { groupName?: string }
      return { groupName: data.groupName }
    }
  } catch (e) {
    console.error('getLineGroupSummary error:', e)
  }
  return {}
}

// グループ情報の保存
async function saveGroupInfo(db: D1Database, groupId: string, name?: string, accessToken?: string) {
  try {
    let groupName = name
    if ((!groupName || groupName === 'グループ') && accessToken) {
      const summary = await getLineGroupSummary(groupId, accessToken)
      if (summary.groupName) {
        groupName = summary.groupName
      }
    }
    await db.prepare(`
      INSERT INTO line_groups (id, name, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET 
        name = CASE 
          WHEN excluded.name IS NOT NULL AND excluded.name != '' AND excluded.name != 'グループ' THEN excluded.name 
          ELSE line_groups.name 
        END,
        updated_at = CURRENT_TIMESTAMP
    `).bind(groupId, groupName || 'グループ').run()
  } catch (e) {
    console.error('saveGroupInfo error:', e)
  }
}

// ユーザーとグループの所属関係を保存
async function linkUserToGroup(db: D1Database, userId: string, groupId: string) {
  try {
    await db.prepare(`
      INSERT INTO user_groups (user_id, group_id, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, group_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
    `).bind(userId, groupId).run()
  } catch (e) {
    console.error('linkUserToGroup error:', e)
  }
}

// 所属グループへの出勤・退勤通知（該当ユーザーが所属しているグループにのみ送信）
async function notifyGroupAttendance(
  db: D1Database,
  userId: string,
  userName: string,
  actionType: '出勤' | '退勤',
  timeDisplay: string,
  accessToken?: string,
  excludeGroupId?: string
) {
  if (!accessToken) {
    console.error('notifyGroupAttendance: accessToken is missing')
    return
  }

  try {
    // ユーザーが所属しているグループのみを取得
    const { results: userGroupResults } = await db.prepare(
      'SELECT group_id FROM user_groups WHERE user_id = ?'
    ).bind(userId).all<{ group_id: string }>()

    const groupSet = new Set<string>()
    for (const r of userGroupResults || []) {
      if (r.group_id) groupSet.add(r.group_id)
    }

    let targetGroupIds = Array.from(groupSet)

    // 発信元のグループがあれば除外（二重通知防止）
    if (excludeGroupId) {
      targetGroupIds = targetGroupIds.filter(id => id !== excludeGroupId)
    }

    console.log(`notifyGroupAttendance for ${userName} (${actionType}): targetGroupIds=`, targetGroupIds)

    if (targetGroupIds.length === 0) {
      console.log(`notifyGroupAttendance: no target groups found for user ${userName} (${userId})`)
      return
    }

    const pushText = `【${actionType}通知】\n${userName}さんが${actionType}しました（${timeDisplay}）`

    for (const gid of targetGroupIds) {
      const result = await pushMessage(gid, pushText, accessToken)
      // もしBotが退会済みなど無効なグループだった場合（400エラー等）、DBから削除してクリーンアップ
      if (!result.success && result.status === 400) {
        console.warn(`Group ${gid} failed with 400. Removing from line_groups.`)
        await db.prepare('DELETE FROM line_groups WHERE id = ?').bind(gid).run().catch(() => {})
        await db.prepare('DELETE FROM user_groups WHERE group_id = ?').bind(gid).run().catch(() => {})
      }
    }
  } catch (e) {
    console.error('notifyGroupAttendance error:', e)
  }
}

// LINEプロフィール取得（1対1またはグループ対応）
async function getLineProfile(lineUserId: string, accessToken: string, groupId?: string): Promise<string> {
  try {
    const url = groupId
      ? `https://api.line.me/v2/bot/group/${groupId}/member/${lineUserId}`
      : `https://api.line.me/v2/bot/profile/${lineUserId}`
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    })
    if (res.ok) {
      const profile = await res.json() as { displayName: string }
      return profile.displayName
    }
  } catch {
    // プロフィール取得失敗時はデフォルト名を使う
  }
  return '新規ユーザー'
}

// ユーザー検索、なければ自動登録（共通処理）
async function findOrCreateUser(
  db: D1Database, lineUserId: string, accessToken: string, groupId?: string
): Promise<{ id: string; name: string }> {
  let user = await db.prepare('SELECT id, name FROM users WHERE line_user_id = ?')
    .bind(lineUserId).first<{ id: string; name: string }>()
  
  if (!user) {
    const displayName = await getLineProfile(lineUserId, accessToken, groupId)
    const newUserId = 'u_' + Math.random().toString(36).substring(2, 9)
    await db.prepare('INSERT INTO users (id, name, line_user_id) VALUES (?, ?, ?)')
      .bind(newUserId, displayName, lineUserId).run()
    user = { id: newUserId, name: displayName }
  }
  return user
}

app.post('/webhook', async (c) => {
  const channelSecret = c.env.LINE_CHANNEL_SECRET
  const accessToken = c.env.LINE_CHANNEL_ACCESS_TOKEN
  
  if (!channelSecret || !accessToken) {
    return c.text('Not Configured', 500)
  }

  const signature = c.req.header('x-line-signature')
  const body = await c.req.text()
  
  if (!signature || !(await verifySignature(signature, body, channelSecret))) {
    return c.text('Invalid Signature', 401)
  }

  const data = JSON.parse(body)
  
  for (const event of data.events) {

    // --- 友達追加イベント: ユーザー自動登録 ---
    if (event.type === 'follow') {
      const lineUserId = event.source.userId
      if (lineUserId) {
        const user = await findOrCreateUser(c.env.DB, lineUserId, accessToken)
        if (event.replyToken) {
          await replyMessage(
            event.replyToken,
            `${user.name}さん、友達追加ありがとうございます！\n「出勤」「退勤」とメッセージを送ると打刻できます。`,
            accessToken
          )
        }
      }
      continue
    }

    // --- グループ参加イベント（Botがグループに追加された） ---
    if (event.type === 'join') {
      const groupId = event.source.groupId || event.source.roomId
      if (groupId) {
        await saveGroupInfo(c.env.DB, groupId, undefined, accessToken)
      }
      if (event.replyToken) {
        await replyMessage(
          event.replyToken,
          `グループに参加しました！\nメンバーの皆さんは「出勤」「退勤」「休憩」「再開」とメッセージを送るだけで個別に打刻できます。`,
          accessToken
        )
      }
      continue
    }

    // --- メンバー参加イベント（グループにユーザーが追加された） ---
    if (event.type === 'memberJoined') {
      const groupId = event.source.groupId || event.source.roomId
      if (groupId) {
        await saveGroupInfo(c.env.DB, groupId, undefined, accessToken)
        if (event.joined && Array.isArray(event.joined.members)) {
          for (const member of event.joined.members) {
            if (member.userId) {
              const joinedUser = await findOrCreateUser(c.env.DB, member.userId, accessToken, groupId)
              await linkUserToGroup(c.env.DB, joinedUser.id, groupId)
            }
          }
        }
      }
      continue
    }

    // --- メンバー退出イベント（ユーザーがグループから退出した） ---
    if (event.type === 'memberLeft') {
      const groupId = event.source.groupId || event.source.roomId
      if (groupId && event.left && Array.isArray(event.left.members)) {
        for (const member of event.left.members) {
          if (member.userId) {
            const leftUser = await c.env.DB.prepare('SELECT id FROM users WHERE line_user_id = ?').bind(member.userId).first<{ id: string }>()
            if (leftUser) {
              await c.env.DB.prepare('DELETE FROM user_groups WHERE user_id = ? AND group_id = ?').bind(leftUser.id, groupId).run().catch(() => {})
            }
          }
        }
      }
      continue
    }

    // --- Bot退出イベント（Botがグループから退出した、またはグループが削除された） ---
    if (event.type === 'leave') {
      const groupId = event.source.groupId || event.source.roomId
      if (groupId) {
        await c.env.DB.prepare('DELETE FROM line_groups WHERE id = ?').bind(groupId).run().catch(() => {})
        await c.env.DB.prepare('DELETE FROM user_groups WHERE group_id = ?').bind(groupId).run().catch(() => {})
      }
      continue
    }

    // --- メッセージイベント: 打刻処理 & 所属自動記録 ---
    if (event.type === 'message' && event.message.type === 'text') {
      const text = event.message.text.trim()
      const lineUserId = event.source.userId
      const isGroup = event.source.type === 'group' || event.source.type === 'room'
      const groupId = isGroup ? (event.source.groupId || event.source.roomId) : undefined
      
      // 発言者のuserIdが取得できない場合はスキップ
      if (!lineUserId) continue

      // ユーザー情報の取得または登録
      const user = await findOrCreateUser(c.env.DB, lineUserId, accessToken, groupId)

      // グループ発言の場合は、打刻キーワードかどうかにかかわらず所属関係とグループ情報を裏側で自動記録
      if (isGroup && groupId) {
        await saveGroupInfo(c.env.DB, groupId, undefined, accessToken)
        await linkUserToGroup(c.env.DB, user.id, groupId)
      }

      // 打刻キーワードかどうかの判定
      const isClockIn = text === '出勤'
      const isClockOut = text === '退勤'
      const isBreakStart = text === '休憩' || text === '休憩開始'
      const isBreakEnd = text === '再開' || text === '休憩終了' || text === '戻り'

      // グループトークの場合、打刻キーワード以外の一般会話には反応しない（グループが荒れるのを防ぐためBotは返信せずスキップ）
      if (isGroup && !isClockIn && !isClockOut && !isBreakStart && !isBreakEnd) {
        continue
      }

      // 日本時間の計算とUTC ISO文字列の生成
      const now = new Date()
      const jstOffset = 9 * 60 * 60 * 1000
      const jstTime = new Date(now.getTime() + jstOffset)
      const dateStr = jstTime.toISOString().split('T')[0] // 日本時間の日付 YYYY-MM-DD
      const timeStr = now.toISOString() // 正確なUTC ISO文字列
      
      // LINE返信用の日本時間表示 HH:mm
      const hoursStr = String(jstTime.getUTCHours()).padStart(2, '0')
      const minutesStr = String(jstTime.getUTCMinutes()).padStart(2, '0')
      const timeDisplay = `${hoursStr}:${minutesStr}`
      
      let replyText = ''

      // 当日の既存打刻レコードを取得
      const existingRecord = await c.env.DB.prepare(
        'SELECT clock_in, clock_out, break_start, break_end FROM attendance_records WHERE user_id = ? AND date = ?'
      ).bind(user.id, dateStr).first<{
        clock_in: string | null
        clock_out: string | null
        break_start: string | null
        break_end: string | null
      }>()

      const formatIsoDisplay = (isoStr?: string | null) => {
        if (!isoStr) return ''
        try {
          const d = new Date(isoStr)
          const jstD = new Date(d.getTime() + jstOffset)
          const h = String(jstD.getUTCHours()).padStart(2, '0')
          const m = String(jstD.getUTCMinutes()).padStart(2, '0')
          return `${h}:${m}`
        } catch {
          return ''
        }
      }

      if (isClockIn) {
        if (existingRecord && existingRecord.clock_in) {
          const inTime = formatIsoDisplay(existingRecord.clock_in)
          replyText = `${user.name}さん、本日はすでに出勤打刻済みです（${inTime}）。\n時刻を変更する場合は勤怠画面から修正してください。`
        } else {
          const isHoliday = isNonWorkingDay(dateStr) ? 1 : 0
          const query = `
            INSERT INTO attendance_records (user_id, date, clock_in, is_holiday_work) 
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, date) DO UPDATE SET 
              clock_in = COALESCE(attendance_records.clock_in, excluded.clock_in),
              is_holiday_work = excluded.is_holiday_work
          `
          await c.env.DB.prepare(query).bind(user.id, dateStr, timeStr, isHoliday).run()
          replyText = `${user.name}さん、おはようございます。\n出勤を打刻しました（${timeDisplay}）`

          // 平日8:30前の早出の場合はメモ入力を案内（8:30-9:00は不要）
          const jstTotalMinutes = jstTime.getUTCHours() * 60 + jstTime.getUTCMinutes()
          if (!isHoliday && jstTotalMinutes < 510) {
            replyText += `\n※8:30前の早出打刻です。早出理由は勤怠画面（LIFF）からメモを登録してください。`
          }

          // 個別チャットからの出勤時のみ、所属グループへ通知をPush送信
          if (!isGroup) {
            await notifyGroupAttendance(c.env.DB, user.id, user.name, '出勤', timeDisplay, accessToken)
          }
        }
      } 
      else if (isClockOut) {
        if (existingRecord && existingRecord.clock_out) {
          const outTime = formatIsoDisplay(existingRecord.clock_out)
          replyText = `${user.name}さん、本日はすでに退勤打刻済みです（${outTime}）。\n時刻を変更する場合は勤怠画面から修正してください。`
        } else if (!existingRecord || !existingRecord.clock_in) {
          replyText = `${user.name}さん、本日の出勤打刻がまだ記録されていません。\n先に「出勤」と送信してください。`
        } else {
          const isHoliday = isNonWorkingDay(dateStr)
          const jstHours = jstTime.getUTCHours()
          const isEarlyLeave = !isHoliday && (jstHours < 18)

          if (isEarlyLeave) {
            replyText = `${user.name}さん、18:00前の退勤（早退）には理由の記入と管理者の承認が必要です。\n勤怠画面（LIFF）を開いて早退申請を送信してください。`
          } else {
            const query = `
              UPDATE attendance_records SET clock_out = ? WHERE user_id = ? AND date = ?
            `
            await c.env.DB.prepare(query).bind(timeStr, user.id, dateStr).run()
            replyText = `${user.name}さん、お疲れ様でした。\n退勤を打刻しました（${timeDisplay}）`

            // 個別チャットからの退勤時のみ、所属グループへ通知をPush送信
            if (!isGroup) {
              await notifyGroupAttendance(c.env.DB, user.id, user.name, '退勤', timeDisplay, accessToken)
            }
          }
        }
      }
      else if (isBreakStart || isBreakEnd) {
        replyText = `${user.name}さん、休憩時間は勤務時間に応じて自動付与（6時間超で60分）されるため、休憩の打刻は不要です。`
      }
      else {
        // 1対1トークの時のみヘルプを返す
        replyText = '「出勤」または「退勤」と送信してください。\n休憩時間は自動で付与されます。'
      }

      if (event.replyToken) {
        await replyMessage(event.replyToken, replyText, accessToken)
      }
    }
  }

  return c.text('OK')
})

export default app
