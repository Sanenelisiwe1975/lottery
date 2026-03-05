import "./globals.css";

export const metadata = {
  title:       "LuckyChain Lottery",
  description: "Provably fair on-chain lottery powered by Chainlink VRF",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
