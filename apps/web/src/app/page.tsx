import { redirect } from 'next/navigation';

export default function RootRedirect() {
  // Signed-in users land on the app launcher; unauthenticated users are
  // bounced to /sign-in by SessionGate inside the (app) layout. With
  // NEXT_PUBLIC_EDGE_AUTH_REDIRECT=1, middleware resolves full page loads of
  // `/` in one hop and this page only serves router prefetches.
  redirect('/home');
}
