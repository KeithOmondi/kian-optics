const express = require("express");
const { isSeller, isAuthenticated, isAdmin } = require("../middleware/auth");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const ErrorHandler = require("../utils/ErrorHandler");
const Product = require("../model/product");
const Order = require("../model/order");
const Shop = require("../model/shop");
const cloudinary = require("cloudinary");
const mongoose = require("mongoose");

const router = express.Router();

// Create product
router.post(
  "/create-product",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { shopId, images } = req.body;
      const shop = await Shop.findById(shopId);

      console.log("Incoming shopId:", shopId);
      console.log("Shop found:", shop);

      if (!shop) {
        return next(new ErrorHandler("Shop Id is invalid!", 400));
      }

      let imagesArray = [];
      if (typeof images === "string") {
        imagesArray.push(images);
      } else {
        imagesArray = images;
      }

      const imagesLinks = [];
      for (let i = 0; i < imagesArray.length; i++) {
        try {
          const result = await cloudinary.v2.uploader.upload(imagesArray[i], {
            folder: "products",
          });
          imagesLinks.push({
            public_id: result.public_id,
            url: result.secure_url,
          });
        } catch (uploadError) {
          return next(new ErrorHandler("Image upload failed", 500));
        }
      }

      const productData = {
        ...req.body,
        images: imagesLinks,
        shop: shop._id,
      };

      const product = await Product.create(productData);

      res.status(201).json({
        success: true,
        product,
      });
    } catch (error) {
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Get all products of a shop
router.get(
  "/get-all-products-shop/:id",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const products = await Product.find({ shop: req.params.id });

      res.status(200).json({
        success: true,
        products,
      });
    } catch (error) {
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Delete product of a shop
router.delete(
  "/delete-shop-product/:id",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const product = await Product.findById(req.params.id);

      if (!product) {
        return next(new ErrorHandler("Product not found with this id", 404));
      }

      // Delete images from Cloudinary
      for (let i = 0; i < product.images.length; i++) {
        try {
          const result = await cloudinary.v2.uploader.destroy(
            product.images[i].public_id
          );
          console.log(result);
        } catch (cloudinaryError) {
          console.error("Failed to delete image:", cloudinaryError);
        }
      }

      await product.remove();

      res.status(200).json({
        success: true,
        message: "Product deleted successfully!",
      });
    } catch (error) {
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Get all products
router.get(
  "/get-all-products",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const products = await Product.find().sort({ createdAt: -1 });

      res.status(200).json({
        success: true,
        products,
      });
    } catch (error) {
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Create new review
router.put(
  "/create-new-review",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { rating, comment, productId, orderId } = req.body;
      const user = req.user._id; // Provided by isAuthenticated middleware

      // Validate input
      if (
        !mongoose.Types.ObjectId.isValid(productId) ||
        !mongoose.Types.ObjectId.isValid(orderId)
      ) {
        return next(new ErrorHandler("Invalid product or order ID", 400));
      }

      if (typeof rating !== "number" || rating < 1 || rating > 5) {
        return next(
          new ErrorHandler("Rating must be a number between 1 and 5", 400)
        );
      }

      // Find product and order
      const product = await Product.findById(productId);
      if (!product) {
        return next(new ErrorHandler("Product not found", 404));
      }

      const order = await Order.findById(orderId);
      if (!order) {
        return next(new ErrorHandler("Order not found", 404));
      }

      const isProductInOrder = order.cart.some((item) => {
        return (
          item &&
          item.productId &&
          item.productId.toString() === productId
        );
      });
      

      // Check if user has already reviewed the product
      const existingReview = product.reviews.find(
        (rev) => rev?.user?.toString() === user.toString()
      );

      if (existingReview) {
        existingReview.rating = rating;
        existingReview.comment = comment;
      } else {
        product.reviews.push({
          user,
          rating,
          comment,
          productId,
        });
      }

      // Recalculate average rating
      const totalRating = product.reviews.reduce(
        (sum, review) => sum + review.rating,
        0
      );
      product.ratings = totalRating / product.reviews.length;

      await product.save({ validateBeforeSave: false });

      // Mark product as reviewed in the order
      await Order.findByIdAndUpdate(
        orderId,
        { $set: { "cart.$[elem].isReviewed": true } },
        {
          arrayFilters: [
            { "elem.productId": new mongoose.Types.ObjectId(productId) },
          ],
          new: true,
        }
      ).catch((err) => {
        console.error("Error updating order:", err);
        return next(new ErrorHandler("Failed to update order status", 500));
      });

      res.status(200).json({
        success: true,
        message: "Reviewed successfully!",
      });
    } catch (error) {
      console.error("Error creating review:", error);
      return next(
        new ErrorHandler(error.message || "Something went wrong", 400)
      );
    }
  })
);


// Admin - Get all products
router.get(
  "/admin-all-products",
  isAuthenticated,
  isAdmin("Admin"),
  catchAsyncErrors(async (req, res, next) => {
    try {
      const products = await Product.find().sort({ createdAt: -1 });

      res.status(200).json({
        success: true,
        products,
      });
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

module.exports = router;