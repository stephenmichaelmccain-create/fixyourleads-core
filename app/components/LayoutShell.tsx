import { ReactNode } from 'react';
import { Nav } from './Nav';

export function LayoutShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main style={{ fontFamily: 'sans-serif', padding: 24, maxWidth: 900, margin: '0 auto' }}>
      <Nav />
      <h1>{title}</h1>
      {children}
    </main>
  );
}
