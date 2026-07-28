import { IntelligenceConsole } from "@/components/intelligence-console";
import { OrchestrationPolicyCard } from "@/components/orchestration-policy-card";

export default function IntelligencePage() {
  return (
    <>
      <OrchestrationPolicyCard />
      <IntelligenceConsole />
    </>
  );
}
