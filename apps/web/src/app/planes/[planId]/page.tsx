import { PlanDetails } from "@/components/billing-screens";

export default async function PlanDetailsPage({ params }: { params: Promise<{ planId: string }> }) {
  const { planId } = await params;
  return <PlanDetails planId={planId} />;
}
