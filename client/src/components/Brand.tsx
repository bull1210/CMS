import { useState } from 'react';

/**
 * "Powered by Aatmam Software Pvt. Ltd." — the maker's mark shown in the app
 * chrome (sidebar footer + login). It loads the logo from `/aatmam-logo.png`
 * (drop the file in `client/public/`); until that file exists it falls back to
 * a clean text wordmark so nothing ever looks broken.
 */
export function PoweredByAatmam({ variant = 'dark' }: { variant?: 'dark' | 'light' }) {
  const [imgOk, setImgOk] = useState(true);
  const caption = variant === 'dark' ? 'text-slate-400' : 'text-slate-500';
  const name = variant === 'dark' ? 'text-slate-200' : 'text-slate-700';

  return (
    <div className="flex flex-col items-center gap-1 text-center">
      <span className={`text-[10px] uppercase tracking-wider ${caption}`}>Powered by</span>
      {imgOk ? (
        <img
          src="/aatmam-logo.png"
          alt="Aatmam Software Pvt. Ltd."
          className="h-6 w-auto max-w-[160px] object-contain opacity-90"
          onError={() => setImgOk(false)}
        />
      ) : (
        <span className={`text-xs font-bold ${name}`}>
          Aatmam Software <span className="font-medium opacity-70">Pvt. Ltd.</span>
        </span>
      )}
    </div>
  );
}
