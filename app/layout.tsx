export const metadata = {
  title: 'FixYourLeads Core',
  description: 'Code-first lead ops system'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
