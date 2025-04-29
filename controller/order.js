const express = require("express");
const router = express.Router();
const ErrorHandler = require("../utils/ErrorHandler");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const { isAuthenticated, isSeller, isAdmin } = require("../middleware/auth");
const Order = require("../model/order");
const Shop = require("../model/shop");
const Product = require("../model/product");
const sendMail = require("../utils/sendMail");

// create new order
router.post(
  "/create-order",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { cart, shippingAddress, user, totalPrice, paymentInfo } = req.body;

      // group cart items by shopId
      const shopItemsMap = new Map();

      for (const item of cart) {
        const shopId = item.shopId;
        if (!shopItemsMap.has(shopId)) {
          shopItemsMap.set(shopId, []); // Initialize array for each shop
        }
        shopItemsMap.get(shopId).push(item); // Add items to their respective shops
      }

      // create an order for each shop
      const orders = [];

      for (const [shopId, items] of shopItemsMap) {
        const order = await Order.create({
          cart: items,
          shippingAddress,
          user,
          totalPrice,
          paymentInfo,
        });
        orders.push(order); // Store created orders
      }

      // Styled HTML Email content with inline CSS
      const emailOptions = {
        email: user.email,
        subject: "Order Confirmation",
        message: "Thank you for shopping with Kian Optics!", // Plain text fallback
        htmlMessage: `
          <html>
            <body style="font-family: Arial, sans-serif; line-height: 1.6; margin: 0; padding: 0; background-color: #f4f4f4;">
              <div style="max-width: 600px; margin: 0 auto; background-color: #fff; padding: 20px;">
                <h1 style="text-align: center; color: #333;">Hello ${user.name},</h1>
                <p style="font-size: 16px; color: #555;">Thank you for shopping with <strong style="color: #2a9d8f;">Kian Optics</strong>! Your order has been received and is being processed.
                <br /> You will receive your order within 3 - 4 working days
                </p>
                
                <p style="font-size: 18px; color: #333; font-weight: bold;">Order Details:</p>
                <p style="font-size: 16px; color: #555;">Order ID: <span style="font-weight: bold;">${orders[0]._id}</span></p>
                <p style="font-size: 16px; color: #555;">Total: <span style="font-weight: bold;">Ksh ${totalPrice}</span></p>

                <p style="font-size: 16px; color: #555; margin-top: 20px;">If you have any questions, feel free to contact our support team. <br /> support@kianoptics.co.ke </p>
                 <p style="font-size: 16px; color: red; margin-top: 20px;">This Email is system generated. Please Do not reply</p>
                <footer style="text-align: center; font-size: 14px; color: #777; margin-top: 40px;">
                  <p>&copy; 2025 Kian Optics. All rights reserved.</p>
                </footer>
              </div>
            </body>
          </html>
        `, // Inline Styled HTML content
      };

      // Send the email (ensure this is awaited to prevent race conditions)
      await sendMail(emailOptions);

      res.status(201).json({
        success: true,
        orders,
      });
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// get all orders of user
router.get(
  "/get-all-orders/:userId",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const orders = await Order.find({ "user._id": req.params.userId }).sort({
        createdAt: -1,
      });

      res.status(200).json({
        success: true,
        orders,
      });
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// get all orders of seller
router.get(
  "/get-seller-all-orders/:shopId",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const orders = await Order.find({
        "cart.shopId": req.params.shopId,
      }).sort({
        createdAt: -1,
      });

      res.status(200).json({
        success: true,
        orders,
      });
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// update order status for seller
router.put(
  "/update-order-status/:id",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const order = await Order.findById(req.params.id);

      if (!order) {
        return next(new ErrorHandler("Order not found with this id", 400));
      }

      if (req.body.status === "Transferred to delivery partner") {
        order.cart.forEach(async (o) => {
          await updateOrder(o._id, o.qty);
        });
      }

      order.status = req.body.status;

      if (req.body.status === "Delivered") {
        order.deliveredAt = Date.now();
        order.paymentInfo.status = "Succeeded";
        const serviceCharge = order.totalPrice * 0.1;
        await updateSellerInfo(order.totalPrice - serviceCharge);
      }

      await order.save({ validateBeforeSave: false });

      // Send email to user on status update
      const emailOptions = {
        email: order.user.email,
        subject: `Your order status has been updated to: ${order.status}`,
        message: `Your order with ID ${order._id} is now ${order.status}.`, // Plain fallback
        htmlMessage: `
          <html>
            <body style="font-family: Arial, sans-serif; background-color: #f4f4f4; padding: 20px;">
              <div style="max-width: 600px; margin: auto; background-color: white; padding: 20px; border-radius: 8px;">
                <h2 style="color: #2a9d8f;">Hi ${order.user.name},</h2>
                <p>Your order <strong>#${order._id}</strong> has been updated.</p>
                <p><strong>New Status:</strong> ${order.status}</p>
                <p>Total: Ksh ${order.totalPrice}</p>
                <p style="margin-top: 20px;">Thank you for choosing Kian Optics.</p>
                <footer style="text-align: center; font-size: 12px; color: #777; margin-top: 40px;">
                  &copy; 2025 Kian Optics. All rights reserved.
                </footer>
              </div>
            </body>
          </html>
        `
      };

      await sendMail(emailOptions);

      res.status(200).json({
        success: true,
        order,
      });

      async function updateOrder(id, qty) {
        const product = await Product.findById(id);
        product.stock -= qty;
        product.sold_out += qty;
        await product.save({ validateBeforeSave: false });
      }

      async function updateSellerInfo(amount) {
        const seller = await Shop.findById(req.seller.id);
        seller.availableBalance = amount;
        await seller.save();
      }
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);





// give a refund ----- user
router.put(
  "/order-refund/:id",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const order = await Order.findById(req.params.id);

      if (!order) {
        return next(new ErrorHandler("Order not found with this id", 400));
      }

      order.status = req.body.status;

      await order.save({ validateBeforeSave: false });

      res.status(200).json({
        success: true,
        order,
        message: "Order Refund Request successfully!",
      });
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// accept the refund ---- seller
router.put(
  "/order-refund-success/:id",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const order = await Order.findById(req.params.id);

      if (!order) {
        return next(new ErrorHandler("Order not found with this id", 400));
      }

      order.status = req.body.status;

      await order.save();

      res.status(200).json({
        success: true,
        message: "Order Refund successfull!",
      });

      if (req.body.status === "Refund Success") {
        order.cart.forEach(async (o) => {
          await updateOrder(o._id, o.qty);
        });
      }

      async function updateOrder(id, qty) {
        const product = await Product.findById(id);

        product.stock += qty;
        product.sold_out -= qty;

        await product.save({ validateBeforeSave: false });
      }
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// all orders --- for admin
router.get(
  "/admin-all-orders",
  isAuthenticated,
  isAdmin("Admin"),
  catchAsyncErrors(async (req, res, next) => {
    try {
      const orders = await Order.find().sort({
        deliveredAt: -1,
        createdAt: -1,
      });
      res.status(201).json({
        success: true,
        orders,
      });
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

module.exports = router;
