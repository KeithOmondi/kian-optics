const express = require("express");
const router = express.Router();
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const axios = require("axios");
require('dotenv').config();

// Function to get the access token
const getAccessToken = async () => {
  const apiUrl = 'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials';
  const auth = Buffer.from(`${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`).toString('base64');

  try {
    const response = await axios.get(apiUrl, {
      headers: {
        'Authorization': `Basic ${auth}`,
      },
    });
    return response.data.access_token;
  } catch (error) {
    console.error('Error getting access token:', error);
    return null;
  }
};

// Function to initiate STK Push payment
const initiatePayment = async (amount, phoneNumber, accountNumber) => {
  const token = await getAccessToken();
  if (!token) {
    console.error('Failed to obtain access token');
    return;
  }

  const url = 'https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest';
  const payload = {
    BusinessShortcode: process.env.MPESA_SHORTCODE,
    LipaNaMpesaOnlineShortcode: process.env.MPESA_LIPA_SHORTCODE,
    LipaNaMpesaOnlineShortcodeSecret: process.env.MPESA_LIPA_SHORTCODE_SECRET,
    PhoneNumber: phoneNumber,
    Amount: amount,
    AccountReference: accountNumber,
    PartyA: phoneNumber,
    PartyB: process.env.MPESA_PAYBILL,
    Remarks: 'Payment for order #12345',
    CallBackURL: 'http://localhost:5173',  // Your callback URL to get the payment status
    Shortcode: process.env.MPESA_SHORTCODE,
    Passkey: process.env.MPESA_PASSKEY,
    TransactionType: 'PayBill',
    TransactionID: Date.now(),  // Unique ID for transaction
  };

  try {
    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    return response.data;
  } catch (error) {
    console.error('Error initiating payment:', error);
    return null;
  }
};

// M-Pesa Payment Route (Instead of Stripe)
router.post(
  "/process",
  catchAsyncErrors(async (req, res, next) => {
    const { amount, phoneNumber, accountNumber } = req.body;

    // Initiate the payment via M-Pesa
    const paymentResponse = await initiatePayment(amount, phoneNumber, accountNumber);

    if (paymentResponse) {
      res.status(200).json({
        success: true,
        message: "Payment initiated successfully",
        data: paymentResponse,
      });
    } else {
      res.status(500).json({
        success: false,
        message: "Payment initiation failed",
      });
    }
  })
);

// Callback route to handle payment status updates from M-Pesa
router.post(
  "/callback",
  catchAsyncErrors(async (req, res, next) => {
    const paymentDetails = req.body;
    console.log('Payment Callback:', paymentDetails);

    // Handle the payment status (success/failure)
    // Here, you can update the order status in your database

    // Send a response back to M-Pesa to acknowledge receipt of the callback
    res.status(200).send('OK');
  })
);

module.exports = router;
