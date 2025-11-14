import express from "express";
import axios from "axios";
import { createClient } from "@supabase/supabase-js";

const router = express.Router();

// ✅ HARDCODED VALUES
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_PLAN_CODE = process.env.PAYSTACK_PLAN_CODE;

console.log('✅ Paystack route: Using hardcoded values');

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ✅ 1. Initialize subscription with 3-day free trial
router.post('/initialize-subscription', (req, res, next) => {
  console.log('🔥 Incoming /initialize-subscription');
  next();
});

// ✅ 1. Initialize subscription with 3-day free trial
router.post('/initialize-subscription', async (req, res) => {
  console.log('🎯 /initialize-subscription endpoint HIT');
  console.log('📨 Request body:', req.body);
  console.log('📨 Request headers:', req.headers);
  try {
    console.log('🔄 Received subscription initialization request:', req.body);
    
    const { email, business_id, user_id } = req.body;

    if (!email || !business_id || !user_id) {
      console.log('❌ Missing required fields:', { email, business_id, user_id });
      return res.status(400).json({ 
        success: false, 
        error: 'Email, business ID, and user ID are required' 
      });
    }

    // Calculate trial period (3 days from now)
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 3);
    
    const currentPeriodStart = new Date();
    const currentPeriodEnd = new Date(trialEndsAt);

    console.log('🎯 Creating subscription with trial period:', {
      user_id,
      business_id,
      trialEndsAt: trialEndsAt.toISOString()
    });

    // Create subscription in database with trial
    const { data: subscription, error: subError } = await supabase
      .from('subscriptions')
      .insert([
        {
          user_id: user_id,
          business_id: business_id,
          plan_type: 'professional',
          status: 'trialing',
          plan_name: 'Professional Plan',
          amount: 30000, // ₦30,000
          trial_ends_at: trialEndsAt.toISOString(),
          current_period_start: currentPeriodStart.toISOString(),
          current_period_end: currentPeriodEnd.toISOString(),
          next_billing_date: trialEndsAt.toISOString().split('T')[0],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      ])
      .select()
      .single();

    if (subError) {
      console.error('❌ Subscription creation error:', subError);
      throw new Error('Failed to create subscription: ' + subError.message);
    }

    console.log('✅ Subscription created with trial:', subscription.id);

    // Create Paystack customer
    const customerResponse = await axios.post(
      'https://api.paystack.co/customer',
      { email },
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!customerResponse.data.status) {
      throw new Error('Failed to create Paystack customer: ' + customerResponse.data.message);
    }

    const customerCode = customerResponse.data.data.customer_code;
    console.log('✅ Paystack customer created:', customerCode);

    // Initialize transaction for subscription (will charge after trial)
    const transactionResponse = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email,
        amount: 3000000, // ₦30,000 in kobo
        plan: PAYSTACK_PLAN_CODE,
        customer: customerCode,
        metadata: {
          business_id,
          user_id,
          subscription_id: subscription.id,
          subscription_type: 'monthly',
          is_trial: true
        }
      },
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!transactionResponse.data.status) {
      throw new Error('Failed to initialize transaction: ' + transactionResponse.data.message);
    }

    const { authorization_url, reference } = transactionResponse.data.data;

    // Update subscription with Paystack references
    await supabase
      .from('subscriptions')
      .update({
        customer_code: customerCode,
        paystack_reference: reference,
        updated_at: new Date().toISOString()
      })
      .eq('id', subscription.id);

    console.log('✅ Subscription initialized with Paystack');

    res.json({
      success: true,
      authorization_url,
      reference,
      subscription: {
        id: subscription.id,
        status: 'trialing',
        trial_ends_at: trialEndsAt,
        days_left: 3
      }
    });

  } catch (error) {
    console.error('❌ Paystack initialization error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data?.message || error.message || 'Failed to initialize subscription'
    });
  }
});

// ✅ 2. Verify payment and activate subscription
router.get('/verify/:reference', async (req, res) => {
  try {
    const { reference } = req.params;

    const verificationResponse = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`
        }
      }
    );

    const { status, amount, customer, plan, metadata } = verificationResponse.data.data;

    if (status === 'success') {
      // Update subscription in database
      const { error: updateError } = await supabase
        .from('subscriptions')
        .update({
          status: 'active',
          amount: amount / 100, // Convert from kobo to naira
          customer_code: customer.customer_code,
          plan_code: plan.plan_code,
          updated_at: new Date().toISOString()
        })
        .eq('paystack_reference', reference);

      if (updateError) {
        console.error('❌ Update error:', updateError);
      }

      console.log('✅ Subscription activated for reference:', reference);

      res.json({
        success: true,
        status: 'active',
        message: 'Subscription activated successfully'
      });
    } else {
      res.json({
        success: false,
        status: 'failed',
        message: 'Payment verification failed'
      });
    }

  } catch (error) {
    console.error('❌ Verification error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: 'Payment verification failed'
    });
  }
});

// ✅ 3. SUBSCRIPTION STATUS ENDPOINT - ADD THIS
router.get('/subscription-status/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    
    console.log('🔍 Checking subscription status for business:', businessId);
    
    const { data: subscription, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !subscription) {
      console.log('📭 No subscription found for business:', businessId);
      return res.json({ 
        hasSubscription: false,
        status: 'none',
        isTrial: false,
        daysLeft: 0
      });
    }

    console.log('📊 Found subscription:', subscription);

    // Check trial status
    let isTrial = false;
    let daysLeft = 0;
    
    if (subscription.status === 'trialing' && subscription.trial_ends_at) {
      const now = new Date();
      const trialEnds = new Date(subscription.trial_ends_at);
      const diffTime = trialEnds - now;
      daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      if (daysLeft > 0) {
        isTrial = true;
      } else {
        // Trial expired, update status
        await supabase
          .from('subscriptions')
          .update({ 
            status: 'expired',
            updated_at: new Date().toISOString()
          })
          .eq('id', subscription.id);
        
        subscription.status = 'expired';
        isTrial = false;
        daysLeft = 0;
      }
    }

    // Check grace period
    let isInGracePeriod = false;
    if (subscription.status === 'past_due' && subscription.grace_period_ends) {
      const now = new Date();
      const graceEnds = new Date(subscription.grace_period_ends);
      isInGracePeriod = now <= graceEnds;
    }

    res.json({
      hasSubscription: true,
      ...subscription,
      isTrial,
      daysLeft,
      isInGracePeriod
    });

  } catch (error) {
    console.error('❌ Subscription status error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// PAYSTACK WEBHOOK — FULL AUTOMATED SUBSCRIPTION LIFECYCLE
router.post('/webhook', express.json(), async (req, res) => {
  try {
    const crypto = require('crypto');
    const secret = process.env.PAYSTACK_SECRET_KEY || PAYSTACK_SECRET_KEY; // fallback to your hardcoded
    const signature = req.headers['x-paystack-signature'] || '';

    // Verify signature
    const computed = crypto.createHmac('sha512', secret)
      .update(JSON.stringify(req.body))
      .digest('hex');
    if (!signature || computed !== signature) {
      console.warn('❌ Invalid webhook signature');
      return res.status(401).send('Invalid signature');
    }

    const event = req.body.event;
    const data = req.body.data;

    console.log('📩 PAYSTACK WEBHOOK EVENT:', event);

    // Useful fields (different Paystack payload shapes)
    const customerCode = data.customer?.customer_code || data.customer?.customerCode || data.customer_code;
    const subscriptionCode = data.subscription?.subscription_code || data.subscription?.subscriptionCode || data.subscription_code;
    const nextPayment = data.subscription?.next_payment_date || data.next_payment_date || data.next_payment_at || null;
    const status = data.subscription?.status || data.status || null;

        // Find matching subscription by customer code OR paystack subscription code
    let { data: subscriptionRecord, error: subFindError } = await supabase
      .from('subscriptions')
      .select('*')
      .or(`customer_code.eq.${customerCode},paystack_subscription_code.eq.${subscriptionCode}`)
      .limit(1)
      .maybeSingle();

    if (subFindError) {
      console.error('❌ Error finding subscription record:', subFindError);
      return res.status(500).send('error');
    }
    if (!subscriptionRecord) {
      console.log('⚠️ No subscription found for customer/subscription code. ignoring.');
      return res.status(200).send('ok');
    }

    const subscriptionId = subscriptionRecord.id;
    const companyId = subscriptionRecord.company_id || subscriptionRecord.business_id || subscriptionRecord.company;

    // Helper to update subscriptions + mirror to companies
    async function updateSubscriptionAndCompany(subUpdates, companyUpdates = {}) {
      if (Object.keys(subUpdates).length) {
        await supabase.from('subscriptions').update(subUpdates).eq('id', subscriptionId);
      }
      if (companyId && Object.keys(companyUpdates).length) {
        await supabase.from('companies').update(companyUpdates).eq('id', companyId);
      }
    }

        // 1) Activation
    if (event === 'subscription.create' || event === 'subscription.enable') {
      console.log('🟢 Subscription activated', subscriptionCode);
      await updateSubscriptionAndCompany({
        status: 'active',
        paystack_subscription_code: subscriptionCode || subscriptionRecord.paystack_subscription_code,
        current_period_end: nextPayment ? new Date(nextPayment).toISOString() : subscriptionRecord.current_period_end,
        updated_at: new Date().toISOString()
      }, {
        subscription_status: 'active',
        current_period_end: nextPayment ? new Date(nextPayment).toISOString() : subscriptionRecord.current_period_end
      });
    }

    // 2) Successful recurring charge
    if (event === 'charge.success' && data.status === 'success') {
      console.log('💳 Recurring charge successful for:', subscriptionCode || subscriptionRecord.paystack_subscription_code);
      await updateSubscriptionAndCompany({
        status: 'active',
        failed_attempts: 0,
        last_failed_at: null,
        grace_period_ends: null,
        current_period_end: nextPayment ? new Date(nextPayment).toISOString() : subscriptionRecord.current_period_end,
        updated_at: new Date().toISOString()
      }, {
        subscription_status: 'active',
        current_period_end: nextPayment ? new Date(nextPayment).toISOString() : subscriptionRecord.current_period_end
      });
    }

    // 3) Payment failure (invoice.payment_failed)
    if (event === 'invoice.payment_failed' || (event === 'charge.failed')) {
      console.log('🟠 Payment failed for subscription:', subscriptionCode);
      const newFailed = (subscriptionRecord.failed_attempts || 0) + 1;
      const maxAttempts = subscriptionRecord.max_failed_attempts || 3;
      const graceEnds = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // 3 days grace
      const subUpdate = {
        status: newFailed >= maxAttempts ? 'cancelled' : 'past_due',
        failed_attempts: newFailed,
        last_failed_at: new Date().toISOString(),
        grace_period_ends: graceEnds.toISOString(),
        updated_at: new Date().toISOString()
      };
      if (newFailed >= maxAttempts) {
        subUpdate.cancelled_at = new Date().toISOString();
        subUpdate.cancellation_reason = 'Max payment attempts failed';
      }
      await updateSubscriptionAndCompany(subUpdate, {
        subscription_status: newFailed >= maxAttempts ? 'cancelled' : 'past_due'
      });
    }

    // 4) Cancel / disable
    if (event === 'subscription.disable' || event === 'subscription.cancelled') {
      console.log('🔴 Subscription cancelled/disabled:', subscriptionCode);
      await updateSubscriptionAndCompany({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, {
        subscription_status: 'cancelled'
      });
    }

    console.log('✅ Webhook processed');
    return res.status(200).send('ok');

  } catch (err) {
    console.error('❌ Webhook processing error:', err);
    return res.status(500).send('error');
  }
});


// ✅ 6. Cancel subscription
router.post('/cancel-subscription', async (req, res) => {
  try {
    const { subscriptionId } = req.body;
    
    // Get subscription details
    const { data: subscription, error: fetchError } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('id', subscriptionId)
      .single();

    if (fetchError || !subscription) {
      throw new Error('Subscription not found');
    }

    // Disable subscription in Paystack if we have the code
    if (subscription.paystack_subscription_code) {
      await axios.post(
        `https://api.paystack.co/subscription/disable`,
        {
          code: subscription.paystack_subscription_code,
          token: PAYSTACK_SECRET_KEY
        },
        {
          headers: {
            Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );
    }

    // Update database
    await supabase
      .from('subscriptions')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancellation_reason: 'Cancelled by user',
        updated_at: new Date().toISOString()
      })
      .eq('id', subscriptionId);

    res.json({ 
      success: true, 
      message: 'Subscription cancelled successfully' 
    });

  } catch (error) {
    console.error('❌ Cancel subscription error:', error);
    res.status(500).json({ 
      success: false,
      error: error.response?.data?.message || error.message 
    });
  }
});

export default router;