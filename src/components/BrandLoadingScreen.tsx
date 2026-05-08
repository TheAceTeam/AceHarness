'use client';

interface BrandLoadingScreenProps {
  message?: string;
  fullscreen?: boolean;
}

export default function BrandLoadingScreen({
  message = '加载中...',
  fullscreen = true,
}: BrandLoadingScreenProps) {
  return (
    <div className={`${fullscreen ? 'h-screen' : 'h-full min-h-[240px]'} flex items-center justify-center bg-background`}>
      <div className="flex flex-col items-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-blue-600">
          <svg className="h-6 w-6 animate-spin text-white" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}
