const { expect } = require('chai');
const { ethers } = require('hardhat');

// Support both ethers v5 (utils) and v6 (top-level)
if (!ethers.utils) {
  ethers.utils = {
    parseUnits: (v, u) => ethers.parseUnits(String(v), Number(u)),
    keccak256: (b) => ethers.keccak256(b),
    toUtf8Bytes: (s) => ethers.toUtf8Bytes(s)
  };
}

describe('DiemCreditEscrow', function () {
  let escrow, usdc, owner, provider, consumer;
  const PLATFORM_FEE_BPS = 100; // 1%
  const UNUSED_PENALTY_BPS = 500; // 5%
  
  beforeEach(async function () {
    [owner, provider, consumer] = await ethers.getSigners();
    const usdcAddr = (a) => a?.target ?? a?.address;

    // Deploy mock USDC
    const MockERC20 = await ethers.getContractFactory('MockERC20');
    usdc = await MockERC20.deploy('USD Coin', 'USDC', 6);
    if (usdc.waitForDeployment) await usdc.waitForDeployment(); else await usdc.deployed();

    // Deploy escrow
    const DiemCreditEscrow = await ethers.getContractFactory('DiemCreditEscrow');
    escrow = await DiemCreditEscrow.deploy(usdcAddr(usdc));
    if (escrow.waitForDeployment) await escrow.waitForDeployment(); else await escrow.deployed();

    // Mint USDC to consumer
    await usdc.mint(consumer.address, ethers.utils.parseUnits('1000', 6));
  });

  describe('Escrow Creation', function () {
    it('Should create an escrow', async function () {
      const diemLimit = 100; // $1.00 in cents
      const amount = ethers.utils.parseUnits('0.95', 6); // 0.95 USDC
      
      const tx = await escrow.connect(consumer).createEscrow(
        provider.address,
        diemLimit,
        amount,
        0 // default 24h
      );
      
      const receipt = await tx.wait();
      const event = receipt.events.find(e => e.event === 'EscrowCreated');
      
      expect(event.args.provider).to.equal(provider.address);
      expect(event.args.consumer).to.equal(consumer.address);
      expect(event.args.amount).to.equal(amount);
      expect(event.args.diemLimit).to.equal(diemLimit);
    });
    
    it('Should fail if provider is zero address', async function () {
      await expect(
        escrow.connect(consumer).createEscrow(
          ethers.constants.AddressZero,
          100,
          ethers.utils.parseUnits('0.95', 6),
          0
        )
      ).to.be.revertedWith('Invalid provider');
    });
    
    it('Should fail if consumer is also provider', async function () {
      await expect(
        escrow.connect(consumer).createEscrow(
          consumer.address,
          100,
          ethers.utils.parseUnits('0.95', 6),
          0
        )
      ).to.be.revertedWith('Cannot escrow with self');
    });

    it('Should fail if amount exceeds max escrow cap', async function () {
      const maxAmt = await escrow.maxEscrowAmount();
      const overMax = typeof maxAmt === 'bigint' ? maxAmt + 1n : maxAmt.add(1);
      await expect(
        escrow.connect(consumer).createEscrow(
          provider.address,
          100,
          overMax,
          0
        )
      ).to.be.revertedWith('Amount exceeds max escrow cap');
    });
  });

  describe('Funding', function () {
    let escrowId;
    
    beforeEach(async function () {
      const tx = await escrow.connect(consumer).createEscrow(
        provider.address,
        100, // $1.00
        ethers.utils.parseUnits('0.95', 6),
        0
      );
      const receipt = await tx.wait();
      escrowId = receipt.events[0].args.escrowId;
      
      // Approve USDC
      await usdc.connect(consumer).approve(escrow.address, ethers.utils.parseUnits('0.95', 6));
    });
    
    it('Should fund an escrow', async function () {
      await expect(escrow.connect(consumer).fundEscrow(escrowId))
        .to.emit(escrow, 'EscrowFunded')
        .withArgs(escrowId, ethers.utils.parseUnits('0.95', 6));
      
      const escrowData = await escrow.getEscrow(escrowId);
      expect(escrowData.status).to.equal(1); // Funded
    });
    
    it('Should fail if not consumer', async function () {
      await expect(escrow.connect(provider).fundEscrow(escrowId))
        .to.be.revertedWith('Not consumer');
    });
  });

  describe('Usage and Settlement', function () {
    let escrowId;
    const diemLimit = 100; // $1.00
    const amount = ethers.utils.parseUnits('0.95', 6);
    
    beforeEach(async function () {
      // Create and fund escrow
      const tx = await escrow.connect(consumer).createEscrow(
        provider.address,
        diemLimit,
        amount,
        0
      );
      const receipt = await tx.wait();
      escrowId = receipt.events[0].args.escrowId;
      
      await usdc.connect(consumer).approve(escrow.address, amount);
      await escrow.connect(consumer).fundEscrow(escrowId);
      
      // Provider delivers key
      const keyHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('test-key'));
      await escrow.connect(provider).deliverKey(escrowId, keyHash);
    });
    
    it('Should complete escrow with partial usage after dispute window', async function () {
      const usage = 50; // Used $0.50 of $1.00
      
      // Consumer reports
      await escrow.connect(consumer).reportUsage(escrowId, usage);
      
      // Provider confirms (sets completionUnlockTime; does not complete immediately)
      await escrow.connect(provider).reportUsage(escrowId, usage);
      
      const escrowDataBefore = await escrow.getEscrow(escrowId);
      expect(Number(escrowDataBefore.status)).to.equal(2); // Still Active
      const unlock = escrowDataBefore.completionUnlockTime ?? escrowDataBefore[11];
      expect(Number(unlock)).to.be.gt(0);

      // Advance time past completion delay (1 hour)
      await ethers.provider.send('evm_increaseTime', [3600 + 1]);
      await ethers.provider.send('evm_mine', []);

      // Anyone can call executeCompletion after dispute window
      await expect(escrow.connect(consumer).executeCompletion(escrowId))
        .to.emit(escrow, 'EscrowCompleted');
      
      const escrowData = await escrow.getEscrow(escrowId);
      expect(escrowData.status).to.equal(3); // Completed
      
      // Check provider balance
      const providerBalance = await escrow.providerBalances(provider.address);
      // 0.95 * 50/100 = 0.475 used
      // Platform fee: 1% of 0.475 = 0.00475
      // Unused: 0.475, penalty 5% = 0.02375
      // Provider gets: 0.475 - 0.00475 + 0.02375 = 0.494
      expect(providerBalance).to.be.closeTo(
        ethers.utils.parseUnits('0.494', 6),
        ethers.utils.parseUnits('0.001', 6)
      );
    });
    
    it('Should handle full usage', async function () {
      await escrow.connect(consumer).reportUsage(escrowId, diemLimit);
      await escrow.connect(provider).reportUsage(escrowId, diemLimit);
      
      await ethers.provider.send('evm_increaseTime', [3600 + 1]);
      await ethers.provider.send('evm_mine', []);
      await escrow.connect(provider).executeCompletion(escrowId);
      
      const providerBalance = await escrow.providerBalances(provider.address);
      // 0.95 * 1.0 = 0.95 used
      // Platform fee: 1% = 0.0095
      // Provider gets: 0.95 - 0.0095 = 0.9405
      expect(providerBalance).to.be.closeTo(
        ethers.utils.parseUnits('0.9405', 6),
        ethers.utils.parseUnits('0.001', 6)
      );
    });
    
    it('Should fail if usage exceeds limit', async function () {
      await expect(
        escrow.connect(consumer).reportUsage(escrowId, diemLimit + 1)
      ).to.be.revertedWith('Usage exceeds limit');
    });
  });

  describe('Provider Withdrawal', function () {
    it('Should allow provider to withdraw', async function () {
      // Setup completed escrow first
      const tx = await escrow.connect(consumer).createEscrow(
        provider.address,
        100,
        ethers.utils.parseUnits('0.95', 6),
        0
      );
      const receipt = await tx.wait();
      const escrowId = receipt.events[0].args.escrowId;
      
      await usdc.connect(consumer).approve(escrow.address, ethers.utils.parseUnits('0.95', 6));
      await escrow.connect(consumer).fundEscrow(escrowId);
      
      const keyHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('test-key'));
      await escrow.connect(provider).deliverKey(escrowId, keyHash);
      
      await escrow.connect(consumer).reportUsage(escrowId, 100);
      await escrow.connect(provider).reportUsage(escrowId, 100);
      await ethers.provider.send('evm_increaseTime', [3600 + 1]);
      await ethers.provider.send('evm_mine', []);
      await escrow.connect(consumer).executeCompletion(escrowId);
      
      // Withdraw
      const balanceBefore = await usdc.balanceOf(provider.address);
      await escrow.connect(provider).withdrawProviderBalance();
      const balanceAfter = await usdc.balanceOf(provider.address);
      
      expect(balanceAfter).to.be.gt(balanceBefore);
    });
    
    it('Should fail if no balance', async function () {
      await expect(
        escrow.connect(provider).withdrawProviderBalance()
      ).to.be.revertedWith('No balance');
    });
  });
});
