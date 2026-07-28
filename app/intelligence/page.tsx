import { IntelligenceConsole } from "@/components/intelligence-console";
import { MarketVenueLedger } from "@/components/market-venue-ledger";
import { OrchestrationPolicyCard } from "@/components/orchestration-policy-card";

export default function IntelligencePage() {
  return (
    <>
      <OrchestrationPolicyCard />
      <MarketVenueLedger />
      <IntelligenceConsole />
    </>
  );
}
