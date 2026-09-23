// Test script to verify escrow release functionality
const { releaseEscrowFunds, getAllWalletBalances } = require('./utils/wallet-utils');

async function testEscrowRelease() {
  try {
    console.log('Testing escrow release functionality...');
    
    // Test parameters (using sample data from schema)
    const clientId = 1;  // Sample client user ID
    const runnerId = 2;   // Sample runner user ID
    const errandId = 2;   // Sample errand ID
    const amount = 15.00; // Sample amount
    
    console.log('Test parameters:', { clientId, runnerId, errandId, amount });
    
    // Get initial wallet balances
    console.log('\n--- Initial Wallet Balances ---');
    const clientBalancesBefore = await getAllWalletBalances(clientId);
    const runnerBalancesBefore = await getAllWalletBalances(runnerId);
    
    console.log('Client wallets before:', clientBalancesBefore);
    console.log('Runner wallets before:', runnerBalancesBefore);
    
    // Attempt to release escrow funds
    console.log('\n--- Attempting to Release Escrow Funds ---');
    const result = await releaseEscrowFunds(clientId, runnerId, errandId, amount);
    console.log('Release result:', result);
    
    // Get final wallet balances
    console.log('\n--- Final Wallet Balances ---');
    const clientBalancesAfter = await getAllWalletBalances(clientId);
    const runnerBalancesAfter = await getAllWalletBalances(runnerId);
    
    console.log('Client wallets after:', clientBalancesAfter);
    console.log('Runner wallets after:', runnerBalancesAfter);
    
    // Calculate changes
    const clientEscrowChange = clientBalancesAfter.escrow - clientBalancesBefore.escrow;
    const runnerWithdrawableChange = runnerBalancesAfter.withdrawable - runnerBalancesBefore.withdrawable;
    
    console.log('\n--- Balance Changes ---');
    console.log(`Client escrow changed by: $${clientEscrowChange}`);
    console.log(`Runner withdrawable changed by: $${runnerWithdrawableChange}`);
    
    // Verify the transaction worked correctly
    if (clientEscrowChange === -amount && runnerWithdrawableChange === amount) {
      console.log('\n✅ TEST PASSED: Escrow funds were successfully released!');
    } else {
      console.log('\n❌ TEST FAILED: Balance changes do not match expected amounts');
    }
    
  } catch (error) {
    console.error('\n❌ TEST FAILED with error:', error.message);
    console.error('Stack trace:', error.stack);
  }
  
  // Exit the process
  process.exit(0);
}

testEscrowRelease();
