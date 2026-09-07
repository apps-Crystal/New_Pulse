import './globals.css';

export const metadata = {
  title: 'Pulse | Cold Chain Monitor',
  description: 'Real-time cold chain monitoring for the Crystal cold-storage facility',
  icons: { icon: '/favicon.ico' },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Dark-mode bootstrap: apply the `dark` class before first paint from localStorage / OS preference. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.theme;if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark');}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-screen bg-[#f3f4f6] font-sans text-gray-800 antialiased transition-colors duration-300 dark:bg-slate-900 dark:text-slate-100">
        {children}
      </body>
    </html>
  );
}
