import React, { useState } from 'react';
import { LogIn, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { store } from '../store';
import { apiStore } from '../apiStore';
import type { User } from '../types';

interface LoginProps {
  onLogin: (user: User) => void;
}

export const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [selectedUserId, setSelectedUserId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!selectedUserId) {
      setError('ユーザー名またはIDを入力してください');
      return;
    }
    if (!password) {
      setError('パスワードを入力してください');
      return;
    }

    setIsLoading(true);

    try {
      // バックエンドAPIで認証を試行
      let user = await apiStore.loginAdmin(selectedUserId, password);
      // ローカルモックストアへのフォールバック
      if (!user) {
        user = await store.authenticate(selectedUserId, password);
      }

      if (user) {
        onLogin(user);
      } else {
        setError('ユーザーID/名前またはパスワードが正しくありません');
      }
    } catch {
      setError('ログイン処理中にエラーが発生しました');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-wrapper">
      <div className="login-card animate-fade-in">
        {/* ロゴエリア */}
        <div className="login-logo-area">
          <div className="login-logo-icon">
            <LogIn size={32} />
          </div>
          <h1 className="login-title">勤怠管理システム</h1>
          <p className="login-subtitle">ログインしてください</p>
        </div>

        {/* ログインフォーム */}
        <form onSubmit={handleSubmit} className="login-form">
          {error && (
            <div className="login-error animate-fade-in">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          <div className="form-group">
            <label htmlFor="user-id">管理者名 または ID</label>
            <input
              id="user-id"
              type="text"
              value={selectedUserId}
              onChange={e => { setSelectedUserId(e.target.value); setError(''); }}
              placeholder="例: 管理者 または ユーザーID"
              autoComplete="username"
            />
          </div>

          <div className="form-group">
            <label htmlFor="password-input">パスワード</label>
            <div className="password-input-wrapper">
              <input
                id="password-input"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => { setPassword(e.target.value); setError(''); }}
                placeholder="パスワードを入力"
                autoComplete="current-password"
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'パスワードを隠す' : 'パスワードを表示'}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="btn btn-primary btn-large login-submit"
          >
            {isLoading ? (
              <span className="login-spinner" />
            ) : (
              <>
                <LogIn size={20} />
                管理者ログイン
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
