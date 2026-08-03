use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, TransferChecked};

declare_id!("5y8JA9jj4MNPLzPveGkEkfpaXRyqnXjffiC1yZ2UnUNv");

pub const USDC_MINT: Pubkey = pubkey!("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
pub const MAX_EXPIRY_DURATION: i64 = 7 * 24 * 60 * 60;

#[program]
pub mod benefit_escrow {
    use super::*;

    pub fn initialize_order(
        ctx: Context<InitializeOrder>,
        event_commitment: [u8; 32],
        amount: u64,
        expires_at: i64,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;

        validate_initialization(
            &event_commitment,
            amount,
            expires_at,
            now,
            ctx.accounts.institution.key,
            ctx.accounts.merchant.key,
            ctx.accounts.delivery_authority.key,
        )?;

        let order = &mut ctx.accounts.order_escrow;
        order.commitment = event_commitment;
        order.institution = *ctx.accounts.institution.key;
        order.merchant = *ctx.accounts.merchant.key;
        order.delivery_authority = *ctx.accounts.delivery_authority.key;
        order.mint = ctx.accounts.mint.key();
        order.amount = amount;
        order.expires_at = expires_at;
        order.state = OrderState::Locked;
        order.terminal_at = 0;
        order.bump = ctx.bumps.order_escrow;

        emit!(OrderInitialized {
            commitment: event_commitment,
            institution: order.institution,
            merchant: order.merchant,
            amount,
            expires_at,
        });

        Ok(())
    }

    pub fn release(ctx: Context<Release>, event_commitment: [u8; 32]) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let order = &mut ctx.accounts.order_escrow;
        let vault = &ctx.accounts.vault;
        let surplus = vault.amount.checked_sub(order.amount).unwrap_or(0);

        validate_release(
            &order.state,
            vault.amount,
            order.amount,
            order.expires_at,
            now,
        )?;

        order.state = OrderState::Released;
        order.terminal_at = now;

        let seeds = &[b"order".as_ref(), order.commitment.as_ref(), &[order.bump]];
        let signer = &[&seeds[..]];

        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: vault.to_account_info(),
                    to: ctx.accounts.merchant_ata.to_account_info(),
                    authority: order.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                },
                signer,
            ),
            order.amount,
            ctx.accounts.mint.decimals,
        )?;

        if surplus > 0 {
            token::transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: vault.to_account_info(),
                        to: ctx.accounts.institution_ata.to_account_info(),
                        authority: order.to_account_info(),
                        mint: ctx.accounts.mint.to_account_info(),
                    },
                    signer,
                ),
                surplus,
                ctx.accounts.mint.decimals,
            )?;
        }

        token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: vault.to_account_info(),
                destination: ctx.accounts.institution.to_account_info(),
                authority: order.to_account_info(),
            },
            signer,
        ))?;

        emit!(OrderTerminal {
            commitment: order.commitment,
            state: order.state,
            terminal_at: now,
        });

        Ok(())
    }

    pub fn refund_timeout(ctx: Context<RefundTimeout>, event_commitment: [u8; 32]) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let order = &mut ctx.accounts.order_escrow;
        let vault = &ctx.accounts.vault;
        let surplus = vault.amount.checked_sub(order.amount).unwrap_or(0);

        validate_refund(
            &order.state,
            vault.amount,
            order.amount,
            order.expires_at,
            now,
        )?;

        order.state = OrderState::Refunded;
        order.terminal_at = now;

        let seeds = &[b"order".as_ref(), order.commitment.as_ref(), &[order.bump]];
        let signer = &[&seeds[..]];

        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: vault.to_account_info(),
                    to: ctx.accounts.institution_ata.to_account_info(),
                    authority: order.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                },
                signer,
            ),
            order.amount,
            ctx.accounts.mint.decimals,
        )?;

        if surplus > 0 {
            token::transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: vault.to_account_info(),
                        to: ctx.accounts.institution_ata.to_account_info(),
                        authority: order.to_account_info(),
                        mint: ctx.accounts.mint.to_account_info(),
                    },
                    signer,
                ),
                surplus,
                ctx.accounts.mint.decimals,
            )?;
        }

        token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: vault.to_account_info(),
                destination: ctx.accounts.institution.to_account_info(),
                authority: order.to_account_info(),
            },
            signer,
        ))?;

        emit!(OrderTerminal {
            commitment: order.commitment,
            state: order.state,
            terminal_at: now,
        });

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(event_commitment: [u8; 32], amount: u64, expires_at: i64)]
pub struct InitializeOrder<'info> {
    #[account(mut)]
    pub institution: Signer<'info>,
    /// CHECK: Stored safely without modification
    pub merchant: UncheckedAccount<'info>,
    /// CHECK: Stored safely without modification
    pub delivery_authority: UncheckedAccount<'info>,
    #[account(address = USDC_MINT @ EscrowError::InvalidMint)]
    pub mint: Account<'info, Mint>,
    #[account(
        init,
        payer = institution,
        space = 8 + OrderEscrow::INIT_SPACE,
        seeds = [b"order", event_commitment.as_ref()],
        bump
    )]
    pub order_escrow: Account<'info, OrderEscrow>,
    #[account(
        init_if_needed,
        payer = institution,
        associated_token::mint = mint,
        associated_token::authority = order_escrow
    )]
    pub vault: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
#[instruction(event_commitment: [u8; 32])]
pub struct Release<'info> {
    #[account(mut)]
    pub delivery_authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"order", event_commitment.as_ref()],
        bump = order_escrow.bump,
        has_one = delivery_authority @ EscrowError::Unauthorized,
        has_one = merchant @ EscrowError::InvalidDestination,
        has_one = institution @ EscrowError::InvalidDestination,
        has_one = mint @ EscrowError::InvalidMint,
    )]
    pub order_escrow: Account<'info, OrderEscrow>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = order_escrow,
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(address = USDC_MINT @ EscrowError::InvalidMint)]
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = merchant,
    )]
    pub merchant_ata: Account<'info, TokenAccount>,
    /// CHECK: Verified via ATA constraints and order_escrow
    pub merchant: UncheckedAccount<'info>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = institution,
    )]
    pub institution_ata: Account<'info, TokenAccount>,
    /// CHECK: Verified via ATA constraints and order_escrow
    #[account(mut)]
    pub institution: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(event_commitment: [u8; 32])]
pub struct RefundTimeout<'info> {
    #[account(mut)]
    pub institution: Signer<'info>,
    #[account(
        mut,
        seeds = [b"order", event_commitment.as_ref()],
        bump = order_escrow.bump,
        has_one = institution @ EscrowError::Unauthorized,
        has_one = mint @ EscrowError::InvalidMint,
    )]
    pub order_escrow: Account<'info, OrderEscrow>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = order_escrow,
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(address = USDC_MINT @ EscrowError::InvalidMint)]
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = institution,
    )]
    pub institution_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum OrderState {
    Locked,
    Released,
    Refunded,
}

#[account]
#[derive(InitSpace)]
pub struct OrderEscrow {
    pub commitment: [u8; 32],
    pub institution: Pubkey,
    pub merchant: Pubkey,
    pub delivery_authority: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub expires_at: i64,
    pub state: OrderState,
    pub terminal_at: i64,
    pub bump: u8,
}

#[event]
pub struct OrderInitialized {
    pub commitment: [u8; 32],
    pub institution: Pubkey,
    pub merchant: Pubkey,
    pub amount: u64,
    pub expires_at: i64,
}

#[event]
pub struct OrderTerminal {
    pub commitment: [u8; 32],
    pub state: OrderState,
    pub terminal_at: i64,
}

#[error_code]
pub enum EscrowError {
    #[msg("Zero commitment is invalid")]
    InvalidCommitment,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Expiry must be in the future")]
    ExpiryPast,
    #[msg("Expiry cannot be more than 7 days ahead")]
    ExpiryTooFar,
    #[msg("Parties must be distinct")]
    SameParties,
    #[msg("Order is not in Locked state (replay/opposite terminal)")]
    NotLocked,
    #[msg("Too early to refund")]
    TooEarly,
    #[msg("Too late to release")]
    TooLate,
    #[msg("Vault balance is less than order amount")]
    Underfunded,
    #[msg("Invalid mint")]
    InvalidMint,
    #[msg("Unauthorized signer")]
    Unauthorized,
    #[msg("Invalid destination account")]
    InvalidDestination,
    #[msg("Invalid pubkey")]
    InvalidKey,
}

pub fn validate_initialization(
    commitment: &[u8; 32],
    amount: u64,
    expires_at: i64,
    now: i64,
    institution: &Pubkey,
    merchant: &Pubkey,
    delivery_authority: &Pubkey,
) -> Result<()> {
    require!(commitment != &[0; 32], EscrowError::InvalidCommitment);
    require!(amount > 0, EscrowError::ZeroAmount);
    require!(expires_at > now, EscrowError::ExpiryPast);

    let max_expiry = now
        .checked_add(MAX_EXPIRY_DURATION)
        .ok_or(error!(EscrowError::ExpiryTooFar))?;
    require!(expires_at <= max_expiry, EscrowError::ExpiryTooFar);

    require!(institution != &Pubkey::default(), EscrowError::InvalidKey);
    require!(merchant != &Pubkey::default(), EscrowError::InvalidKey);
    require!(
        delivery_authority != &Pubkey::default(),
        EscrowError::InvalidKey
    );
    require!(institution != merchant, EscrowError::SameParties);
    require!(institution != delivery_authority, EscrowError::SameParties);
    require!(merchant != delivery_authority, EscrowError::SameParties);

    Ok(())
}

pub fn validate_release(
    state: &OrderState,
    vault_balance: u64,
    amount: u64,
    expires_at: i64,
    now: i64,
) -> Result<()> {
    require!(*state == OrderState::Locked, EscrowError::NotLocked);
    require!(now < expires_at, EscrowError::TooLate);
    require!(vault_balance >= amount, EscrowError::Underfunded);
    Ok(())
}

pub fn validate_refund(
    state: &OrderState,
    vault_balance: u64,
    amount: u64,
    expires_at: i64,
    now: i64,
) -> Result<()> {
    require!(*state == OrderState::Locked, EscrowError::NotLocked);
    require!(now >= expires_at, EscrowError::TooEarly);
    require!(vault_balance >= amount, EscrowError::Underfunded);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_keys() -> (Pubkey, Pubkey, Pubkey) {
        (
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            Pubkey::new_unique(),
        )
    }

    #[test]
    fn test_init_success() {
        let (inst, merch, auth) = setup_keys();
        let now = 1000;
        assert!(
            validate_initialization(&[1; 32], 100, now + 10, now, &inst, &merch, &auth).is_ok()
        );
    }

    #[test]
    fn test_init_zero_commitment() {
        let (inst, merch, auth) = setup_keys();
        let now = 1000;
        let err = validate_initialization(&[0; 32], 100, now + 10, now, &inst, &merch, &auth)
            .unwrap_err();
        assert_eq!(err, EscrowError::InvalidCommitment.into());
    }

    #[test]
    fn test_init_past_expiry() {
        let (inst, merch, auth) = setup_keys();
        let now = 1000;
        let err =
            validate_initialization(&[1; 32], 100, now, now, &inst, &merch, &auth).unwrap_err();
        assert_eq!(err, EscrowError::ExpiryPast.into());
    }

    #[test]
    fn test_init_excessive_expiry() {
        let (inst, merch, auth) = setup_keys();
        let now = 1000;
        let far = now + MAX_EXPIRY_DURATION + 1;
        let err =
            validate_initialization(&[1; 32], 100, far, now, &inst, &merch, &auth).unwrap_err();
        assert_eq!(err, EscrowError::ExpiryTooFar.into());
    }

    #[test]
    fn test_release_boundary() {
        let state = OrderState::Locked;
        let expires_at = 1000;
        assert!(validate_release(&state, 100, 100, expires_at, 999).is_ok());
        let err = validate_release(&state, 100, 100, expires_at, 1000).unwrap_err();
        assert_eq!(err, EscrowError::TooLate.into());
    }

    #[test]
    fn test_refund_boundary() {
        let state = OrderState::Locked;
        let expires_at = 1000;
        let err = validate_refund(&state, 100, 100, expires_at, 999).unwrap_err();
        assert_eq!(err, EscrowError::TooEarly.into());
        assert!(validate_refund(&state, 100, 100, expires_at, 1000).is_ok());
    }

    #[test]
    fn test_amounts() {
        let state = OrderState::Locked;
        let expires_at = 1000;
        let err = validate_release(&state, 90, 100, expires_at, 900).unwrap_err();
        assert_eq!(err, EscrowError::Underfunded.into());
        assert!(validate_release(&state, 100, 100, expires_at, 900).is_ok());
        assert!(validate_refund(&state, 100, 100, expires_at, 1100).is_ok());
        assert!(validate_release(&state, 110, 100, expires_at, 900).is_ok());
        assert!(validate_refund(&state, 110, 100, expires_at, 1100).is_ok());
    }

    #[test]
    fn test_replay_opposite_terminal() {
        let expires_at = 1000;
        let err1 = validate_release(&OrderState::Released, 100, 100, expires_at, 900).unwrap_err();
        assert_eq!(err1, EscrowError::NotLocked.into());
        let err2 = validate_refund(&OrderState::Refunded, 100, 100, expires_at, 1100).unwrap_err();
        assert_eq!(err2, EscrowError::NotLocked.into());
    }
}
