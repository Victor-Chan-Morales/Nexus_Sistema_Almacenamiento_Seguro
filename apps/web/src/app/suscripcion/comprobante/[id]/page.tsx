import { ReceiptScreen } from "@/components/billing-screens";

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReceiptScreen operationId={id} />;
}
