import { PublicFormView } from '@/components/forms/public/public-form-view';

interface PageProps {
  params: Promise<{ token: string }>;
}

// No server-side API calls here: they would all share one per-IP rate limit.
// The client view fetches the form and shows the not-found state on 404.
export default async function PublicFormPage({ params }: PageProps) {
  const { token } = await params;
  return <PublicFormView token={token} />;
}
