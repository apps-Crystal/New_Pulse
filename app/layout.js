import './globals.css';

const GOOGLE_FONTS_CSS =
  'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap';

export const metadata = {
  title: 'Pulse | Cold Chain Monitor',
  description: 'Real-time cold chain monitoring for the Crystal cold-storage facility',
  icons: { icon: '/favicon.ico' },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="dark-only">
      <head>
        <meta name="color-scheme" content="dark" />
        <meta name="theme-color" content="#0b0f1e" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/*
          Non-blocking web fonts: the stylesheet is requested with media="print" so it never blocks first
          paint (the kiosk must render on the system fallback fonts even when the WAN is down), then switched
          to media="all" once it has loaded. <noscript> keeps the fonts when scripts are disabled.
        */}
        <link rel="preload" as="style" href={GOOGLE_FONTS_CSS} />
        <link id="pulse-fonts" rel="stylesheet" href={GOOGLE_FONTS_CSS} media="print" />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var l=document.getElementById('pulse-fonts');if(!l)return;var on=function(){l.media='all'};l.addEventListener('load',on);try{if(l.sheet&&l.sheet.cssRules.length)on()}catch(e){}})();`,
          }}
        />
        <noscript>
          <link rel="stylesheet" href={GOOGLE_FONTS_CSS} />
        </noscript>
      </head>
      <body className="min-h-screen bg-[#0b0f1e] font-sans text-slate-200 antialiased">
        {children}
      </body>
    </html>
  );
}
