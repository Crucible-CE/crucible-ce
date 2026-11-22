import { JoinForm } from "./join-form";

export default async function JoinCodePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <JoinForm code={decodeURIComponent(code).slice(0, 32)} />;
}
