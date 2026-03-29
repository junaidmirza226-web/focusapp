import express from 'express';
import dotenv from 'dotenv';
import https from 'https';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(express.json());

// Enable CORS for development
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

/**
 * Verify purchase token with Google Play API
 * POST /api/verify-purchase
 *
 * Body:
 * {
 *   "packageName": "com.focusfine.app",
 *   "productId": "quick_unlock_15min",
 *   "purchaseToken": "google_play_purchase_token",
 *   "packageId": "com.focusfine.app"
 * }
 */
app.post('/api/verify-purchase', async (req, res) => {
  try {
    const { packageName, productId, purchaseToken, packageId } = req.body;

    if (!packageName || !productId || !purchaseToken) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: packageName, productId, purchaseToken'
      });
    }

    // Verify with Google Play Billing API
    const isValid = await verifyGooglePlayPurchase(
      packageId || packageName,
      productId,
      purchaseToken
    );

    if (isValid) {
      res.json({
        success: true,
        message: 'Purchase verified successfully',
        verified: true
      });
    } else {
      res.status(401).json({
        success: false,
        error: 'Purchase verification failed',
        verified: false
      });
    }
  } catch (error) {
    console.error('Purchase verification error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error during purchase verification'
    });
  }
});

/**
 * Handle Google Play subscription events (webhook)
 * POST /api/webhook/google-play
 */
app.post('/api/webhook/google-play', (req, res) => {
  try {
    const message = req.body.message;

    if (message && message.data) {
      const decodedData = JSON.parse(
        Buffer.from(message.data, 'base64').toString('utf8')
      );

      console.log('Google Play event received:', decodedData.eventType);

      // Handle different event types
      switch (decodedData.eventType) {
        case 'SUBSCRIPTION_PURCHASED':
        case 'SUBSCRIPTION_RENEWED':
          handleSubscriptionEvent(decodedData);
          break;
        case 'SUBSCRIPTION_CANCELED':
        case 'SUBSCRIPTION_EXPIRED':
          handleSubscriptionCancellation(decodedData);
          break;
        default:
          console.log('Unknown event type:', decodedData.eventType);
      }
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook processing error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

/**
 * Get purchase history for a user
 * GET /api/purchase-history/:packageName/:userId
 */
app.get('/api/purchase-history/:packageName/:userId', (req, res) => {
  try {
    const { packageName, userId } = req.params;

    // TODO: Query database for user's purchase history
    // This would require authentication and database setup

    res.json({
      success: true,
      userId,
      packageName,
      purchases: []
    });
  } catch (error) {
    console.error('Error fetching purchase history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch purchase history'
    });
  }
});

/**
 * Health check endpoint
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

/**
 * Verify Google Play purchase with Google's API
 * This requires the package's private key from Google Play Console
 */
async function verifyGooglePlayPurchase(packageName, productId, purchaseToken) {
  try {
    // TODO: Implement actual Google Play API verification
    // This requires OAuth2 credentials from Google Play Console

    // For MVP, we'll implement a basic check
    // In production, you should:
    // 1. Get OAuth2 token for Google Play API
    // 2. Call: https://www.googleapis.com/androidpublisher/v3/applications/{packageName}/purchases/products/{productId}/tokens/{token}
    // 3. Verify the purchase state and expiry time

    console.log(`Verifying purchase: ${packageName}/${productId}/${purchaseToken}`);

    // Simulated verification (replace with actual API call)
    const isValid = purchaseToken.length > 0;

    return isValid;
  } catch (error) {
    console.error('Google Play verification error:', error);
    return false;
  }
}

/**
 * Handle subscription purchase/renewal events
 */
function handleSubscriptionEvent(eventData) {
  console.log('Processing subscription event:', {
    packageName: eventData.packageName,
    productId: eventData.productId,
    timestamp: eventData.eventTimeMillis
  });

  // TODO: Update user's subscription status in database
  // Grant access/extend subscription expiry
}

/**
 * Handle subscription cancellation/expiry events
 */
function handleSubscriptionCancellation(eventData) {
  console.log('Processing subscription cancellation:', {
    packageName: eventData.packageName,
    productId: eventData.productId
  });

  // TODO: Update user's subscription status in database
  // Revoke access/disable feature
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════╗
║   FocusFine Payment Server Running    ║
║   Port: ${PORT}                         ║
║   Environment: ${process.env.NODE_ENV || 'development'}        ║
╚══════════════════════════════════════╝
  `);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});
