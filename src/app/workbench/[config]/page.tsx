'use client';

import dynamic from 'next/dynamic';

const WorkbenchClient = dynamic(() => import('./WorkbenchClient'), { ssr: false });

export default function WorkbenchPage() {
  return <WorkbenchClient />;
}
