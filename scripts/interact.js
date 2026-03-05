/**
 * interact.js – convenience script for common lottery operations on a live network.
 *
 * Usage (set CONTRACT_ADDRESS in .env first):
 *
 *   Buy a ticket:
 *     NUMBERS="1,7,15,23,31,40,49" npx hardhat run scripts/interact.js --network sepolia
 *
 *   Trigger a draw (after round ends):
 *     ACTION=trigger npx hardhat run scripts/interact.js --network sepolia
 *
 *   Count winners for round N:
 *     ACTION=count ROUND=1 npx hardhat run scripts/interact.js --network sepolia
 *
 *   Distribute prizes for round N:
 *     ACTION=distribute ROUND=1 npx hardhat run scripts/interact.js --network sepolia
 *
 *   Withdraw your prize:
 *     ACTION=withdraw npx hardhat run scripts/interact.js --network sepolia
 *
 *   Check round status:
 *     ACTION=status ROUND=1 npx hardhat run scripts/interact.js --network sepolia
 *
 *   Check current round info:
 *     ACTION=current npx hardhat run scripts/interact.js --network sepolia
 */

const { ethers } = require("hardhat");
require("dotenv").config();

const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const ACTION           = process.env.ACTION   || "buy";
const ROUND            = process.env.ROUND    ? BigInt(process.env.ROUND) : 1n;
const NUMBERS          = process.env.NUMBERS  || "";
const BATCH_SIZE       = process.env.BATCH    ? BigInt(process.env.BATCH) : 200n;

async function main() {
  if (!CONTRACT_ADDRESS) {
    throw new Error("CONTRACT_ADDRESS not set in .env");
  }

  const [signer]  = await ethers.getSigners();
  const lottery   = await ethers.getContractAt("DecentralizedLottery", CONTRACT_ADDRESS, signer);
  const ticketPrice = await lottery.TICKET_PRICE();

  console.log(`\nConnected to lottery: ${CONTRACT_ADDRESS}`);
  console.log(`Signer             : ${signer.address}\n`);

  switch (ACTION) {
    case "buy": {
      if (!NUMBERS) throw new Error("Set NUMBERS=a,b,c,d,e,f,g (7 numbers)");
      const nums = NUMBERS.split(",").map(Number);
      if (nums.length !== 7) throw new Error("Exactly 7 numbers required");
      console.log(`Buying ticket with numbers: [${nums.join(", ")}]`);
      const tx = await lottery.buyTicket(nums, { value: ticketPrice });
      const rc = await tx.wait();
      console.log(`Ticket purchased! TX: ${rc.hash}`);
      break;
    }

    case "trigger": {
      const canTrigger = await lottery.canTriggerDraw();
      if (!canTrigger) {
        const secs = await lottery.secondsUntilDraw();
        console.log(`Round not ready. Time remaining: ${secs}s`);
        return;
      }
      console.log("Triggering draw...");
      const tx = await lottery.triggerDraw();
      const rc = await tx.wait();
      console.log(`Draw triggered! TX: ${rc.hash}`);
      break;
    }

    case "count": {
      console.log(`Counting winners for round ${ROUND} (batch ${BATCH_SIZE})...`);
      const tx = await lottery.countRoundWinners(ROUND, BATCH_SIZE);
      const rc = await tx.wait();
      console.log(`TX: ${rc.hash}`);
      const status = await lottery.getRoundStatus(ROUND);
      console.log(`Count progress: ${status.countIdx} / ${status.totalTickets} | Done: ${status.countDone}`);
      if (status.countDone) {
        console.log("Tier counts:", status.tierCounts.map(String).join(", "));
      }
      break;
    }

    case "distribute": {
      console.log(`Distributing prizes for round ${ROUND} (batch ${BATCH_SIZE})...`);
      const tx = await lottery.distributeRound(ROUND, BATCH_SIZE);
      const rc = await tx.wait();
      console.log(`TX: ${rc.hash}`);
      const status = await lottery.getRoundStatus(ROUND);
      console.log(`Distribute progress: ${status.distributeIdx} / ${status.totalTickets} | Done: ${status.distributeDone}`);
      if (status.distributeDone) {
        console.log(`Carry out to next round: ${ethers.formatEther(status.carryOut)} ETH`);
      }
      break;
    }

    case "withdraw": {
      const pending = await lottery.pendingWithdrawals(signer.address);
      if (pending === 0n) {
        console.log("No pending prizes.");
        return;
      }
      console.log(`Withdrawing ${ethers.formatEther(pending)} ETH...`);
      const tx = await lottery.withdrawPrize();
      const rc = await tx.wait();
      console.log(`Withdrawn! TX: ${rc.hash}`);
      break;
    }

    case "status": {
      const s = await lottery.getRoundStatus(ROUND);
      console.log(`Round ${ROUND} status:`);
      console.log(`  Prize pool       : ${ethers.formatEther(s.prizePool)} ETH`);
      console.log(`  Total tickets    : ${s.totalTickets}`);
      console.log(`  Draw completed   : ${s.drawCompleted}`);
      console.log(`  Count done       : ${s.countDone} (${s.countIdx}/${s.totalTickets})`);
      console.log(`  Distribute done  : ${s.distributeDone} (${s.distributeIdx}/${s.totalTickets})`);
      if (s.countDone) {
        console.log(`  Tier counts      : [${s.tierCounts.map(String).join(", ")}]`);
        console.log(`  Prizes / winner  : [${s.tierPrizePerWinner.map(v => ethers.formatEther(v) + " ETH").join(", ")}]`);
      }
      if (s.distributeDone) {
        console.log(`  Carry out        : ${ethers.formatEther(s.carryOut)} ETH`);
      }
      break;
    }

    case "current": {
      const info = await lottery.getCurrentRound();
      const now  = BigInt(Math.floor(Date.now() / 1000));
      const rem  = info.endTime > now ? info.endTime - now : 0n;
      console.log(`Current round: ${info.roundId}`);
      console.log(`  Prize pool   : ${ethers.formatEther(info.prizePool)} ETH`);
      console.log(`  Tickets sold : ${info.totalTickets}`);
      console.log(`  Time left    : ${rem}s`);
      console.log(`  Draw pending : ${info.drawRequested}`);
      const myPending = await lottery.pendingWithdrawals(signer.address);
      if (myPending > 0n) {
        console.log(`\n  Your claimable prize: ${ethers.formatEther(myPending)} ETH`);
      }
      break;
    }

    default:
      console.log(`Unknown action: ${ACTION}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
