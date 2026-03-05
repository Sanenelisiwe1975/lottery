// The lottery UI must run entirely client-side (wallet/ethers).
// We delegate to a Client Component that owns all state.
import LotteryApp from "./LotteryApp";

export default function Home() {
  return <LotteryApp />;
}
