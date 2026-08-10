import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export default function SplashScreen() {
  const navigate = useNavigate();
  const { currentUser, loading } = useAuth();

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!loading) {
        navigate(currentUser ? '/' : '/login', { replace: true });
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [currentUser, loading, navigate]);

  return (
    <div className="screen-container items-center justify-center min-h-screen bg-bg-dark">
      <div className="flex flex-col items-center animate-fade-in">
        <h1 className="font-syne text-3xl font-bold tracking-tight text-text-primary mb-2">VERGR</h1>
        <p className="text-text-muted text-sm font-dmmono tracking-widest uppercase">Play. Stream. Earn.</p>
        <div className="mt-16 w-32 h-[2px] bg-surface-2 rounded-full overflow-hidden">
          <div className="h-full w-full bg-brand-violet/60 rounded-full animate-shimmer" style={{ backgroundSize: '200% 100%', backgroundImage: 'linear-gradient(90deg, transparent 0%, rgba(180,79,255,0.6) 50%, transparent 100%)' }} />
        </div>
      </div>
    </div>
  );
}
