import { useState, useEffect } from 'react';
import { Login } from './components/Login';
import { AdminDashboard } from './components/AdminDashboard';
import { LiffDashboard } from './components/LiffDashboard';
import { initializeLiff } from './liff';
import { apiStore } from './apiStore';
import type { User } from './types';

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isLiff, setIsLiff] = useState(false);

  useEffect(() => {
    // アプリ起動時の初期化処理
    const initApp = async () => {
      try {
        const liffProfile = await initializeLiff();
        if (liffProfile) {
          setIsLiff(true);
          // LIFF環境(LINE内ブラウザ)の場合は自動ログインを試みる
          const lineUser = await apiStore.loginWithLine(liffProfile.userId, liffProfile.displayName);
          if (lineUser) {
            setUser(lineUser);
          }
        } else {
          // LIFF環境でない場合（Web版）は、既存のセッション等があれば復元する
          const savedId = localStorage.getItem('current_user_id');
          if (savedId) {
             // 暫定対応: API側のユーザー一覧から引っ張る等が必要だが、今はモックユーザーを想定
             // setUser(mockUser);
          }
        }
      } catch (e) {
        console.error('App init error:', e);
      } finally {
        setIsInitializing(false);
      }
    };
    initApp();
  }, []);

  const handleLogin = (loggedInUser: User) => {
    setUser(loggedInUser);
    localStorage.setItem('current_user_id', loggedInUser.id);
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('current_user_id');
  };

  if (isInitializing) {
    return (
      <div className="app-shell flex items-center justify-center">
        <div className="text-gray-500 font-medium">起動中...</div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      {!user ? (
        <Login onLogin={handleLogin} />
      ) : isLiff ? (
        <LiffDashboard user={user} />
      ) : user.role === 'admin' ? (
        <AdminDashboard user={user} onLogout={handleLogout} />
      ) : (
        <div className="login-wrapper">
          <div className="login-card animate-fade-in" style={{ textAlign: 'center', padding: '2rem' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold' }}>アクセスエラー</h2>
            <p style={{ marginTop: '1rem', color: 'var(--text-secondary)' }}>
              Web管理画面は管理者専用です。<br />
              打刻や履歴の確認は、スマートフォンのLINEアプリから行ってください。
            </p>
            <button onClick={handleLogout} className="btn btn-secondary" style={{ marginTop: '2rem', width: '100%' }}>
              ログアウト
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;

