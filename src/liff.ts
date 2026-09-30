import liff from '@line/liff';

const LIFF_ID = import.meta.env.VITE_LIFF_ID || '';

export interface LiffUserProfile {
  userId: string;
  displayName: string;
  pictureUrl?: string;
}

export const initializeLiff = async (): Promise<LiffUserProfile | null> => {
  if (!LIFF_ID) {
    console.warn('VITE_LIFF_ID is not set. LIFF initialization skipped.');
    return null;
  }

  try {
    await liff.init({ liffId: LIFF_ID });
    
    // LINEアプリ内（LINE内ブラウザ）でない場合はLINE認証を要求せずWeb版（管理者画面）として動作させる
    if (!liff.isInClient()) {
      return null;
    }

    if (!liff.isLoggedIn()) {
      return null;
    }

    const profile = await liff.getProfile();
    return {
      userId: profile.userId,
      displayName: profile.displayName,
      pictureUrl: profile.pictureUrl,
    };
  } catch (err) {
    console.error('LIFF initialization failed', err);
    return null;
  }
};

export const getLiffIdToken = (): string | null => {
  return liff.getIDToken();
};
