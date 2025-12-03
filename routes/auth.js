import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import nodemailer from "nodemailer";
import User from "../models/User.js";

const router = express.Router();

import logger from "../utils/logger.js";

// Rate limiting for OTP attempts (in-memory, reset on server restart)
const otpAttempts = new Map();
const MAX_OTP_ATTEMPTS = 5;
const OTP_WINDOW = 15 * 60 * 1000; // 15 minutes

const checkOtpRateLimit = (email) => {
  const key = `otp:${email}`;
  const now = Date.now();
  const record = otpAttempts.get(key) || { attempts: 0, resetTime: now };

  if (now - record.resetTime > OTP_WINDOW) {
    record.attempts = 0;
    record.resetTime = now;
  }

  if (record.attempts >= MAX_OTP_ATTEMPTS) {
    return false;
  }

  record.attempts++;
  otpAttempts.set(key, record);
  return true;
};

const validatePassword = (password) => {
  if (!password || password.length < 8) {
    return { valid: false, message: "Password must be at least 8 characters" };
  }
  return { valid: true };
};

const signAccess = (user) =>
  jwt.sign({ sub: user._id, role: user.role }, process.env.JWT_ACCESS_SECRET, {
    expiresIn: process.env.ACCESS_EXPIRES || "15m",
  });
const signRefresh = (user) =>
  jwt.sign({ sub: user._id }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.REFRESH_EXPIRES || "7d",
  });

/**
 * @swagger
 * /auth/register:
 *   post:
 *     summary: Register a new user
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - email
 *               - password
 *             properties:
 *               name:
 *                 type: string
 *                 description: User's full name
 *               email:
 *                 type: string
 *                 format: email
 *                 description: User's email address
 *               password:
 *                 type: string
 *                 minLength: 8
 *                 description: User's password (minimum 8 characters)
 *               role:
 *                 type: string
 *                 enum: [admin, staff, student]
 *                 default: student
 *                 description: User role (students are auto-activated)
 *               collegeName:
 *                 type: string
 *                 description: College name (for students)
 *               mobileNumber:
 *                 type: string
 *                 description: Mobile number
 *               department:
 *                 type: string
 *                 description: Department
 *               yearOfPassing:
 *                 type: number
 *                 description: Year of passing
 *     responses:
 *       201:
 *         description: User registered successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 requiresApproval:
 *                   type: boolean
 *                   description: Whether admin approval is required
 *       400:
 *         description: Bad request (missing fields, invalid email, weak password, or email already exists)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post("/register", async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      role,
      collegeName,
      mobileNumber,
      department,
      yearOfPassing,
    } = req.body;
    const normalizedEmail = (email || "").trim().toLowerCase();
    const normalizedName = (name || "").trim();

    logger.info("User registration attempt", {
      email: normalizedEmail,
      name: normalizedName,
    });

    // Input validation
    if (!normalizedEmail || !normalizedName || !password) {
      logger.warn("Registration failed: Missing required fields", {
        email: normalizedEmail,
        name: normalizedName,
      });
      return res
        .status(400)
        .json({ message: "Name, email, and password are required" });
    }

    // Validate password strength
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      logger.warn("Registration failed: Weak password", {
        email: normalizedEmail,
      });
      return res.status(400).json({ message: passwordValidation.message });
    }

    // Check for duplicate email (only email should be unique)
    const existingEmail = await User.findOne({ email: normalizedEmail });
    if (existingEmail) {
      logger.warn("Registration failed: Email already registered", {
        email: normalizedEmail,
      });
      return res
        .status(400)
        .json({
          message:
            "This email is already registered. Please login or use another email.",
        });
    }

    const hash = await bcrypt.hash(password, 10);
    const validRole = (role || "").trim().toLowerCase() || "student";

    // Validate role
    const allowedRoles = ["admin", "staff", "student"];
    if (!allowedRoles.includes(validRole)) {
      logger.warn("Registration failed: Invalid role", {
        email: normalizedEmail,
        role: validRole,
      });
      return res
        .status(400)
        .json({ message: "Invalid role. Must be admin, staff, or student." });
    }

    const autoActive = validRole === "student";

    const user = await User.create({
      name: normalizedName,
      email: normalizedEmail,
      password: hash,
      role: validRole,
      isActive: autoActive,
      collegeName: collegeName?.trim?.() || undefined,
      mobileNumber: mobileNumber?.trim?.() || undefined,
      department: department?.trim?.() || undefined,
      yearOfPassing: yearOfPassing ? Number(yearOfPassing) : undefined,
    });

    logger.info("User registered successfully", {
      userId: user._id,
      email: user.email,
    });
    res.status(201).json({
      message: autoActive
        ? "Registered successfully. You can login now."
        : "Registered. Await admin approval.",
      requiresApproval: !autoActive,
    });
  } catch (err) {
    logger.error("Registration failed", { error: err.message });
    res.status(500).json({ message: "Registration failed. Please try again." });
  }
});

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Login user and get access token
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful
 *         headers:
 *           Set-Cookie:
 *             description: Refresh token stored in httpOnly cookie (jid)
 *             schema:
 *               type: string
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 accessToken:
 *                   type: string
 *                   description: JWT access token
 *                 user:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     name:
 *                       type: string
 *                     role:
 *                       type: string
 *       400:
 *         description: Invalid credentials
 *       403:
 *         description: Account not approved or disabled
 */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = (email || "").trim().toLowerCase();

    logger.info("Login attempt", { email: normalizedEmail });

    if (!normalizedEmail || !password) {
      logger.warn("Login failed: Missing credentials");
      return res
        .status(400)
        .json({ message: "Email and password are required" });
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      logger.warn("Login failed: User not found", { email: normalizedEmail });
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      logger.warn("Login failed: Invalid password", { email: normalizedEmail });
      return res.status(400).json({ message: "Invalid credentials" });
    }

    if (!user.isActive && user.role !== "student") {
      logger.warn("Login failed: Account not active", {
        email: normalizedEmail,
      });
      return res
        .status(403)
        .json({ message: "Account not approved by admin yet" });
    }

    if (user.disabled) {
      logger.warn("Login failed: Account disabled", { email: normalizedEmail });
      return res.status(403).json({ message: "Account has been disabled" });
    }

    const access = signAccess(user);
    const refresh = signRefresh(user);

    res.cookie("jid", refresh, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });

    logger.info("User logged in successfully", {
      userId: user._id,
      email: user.email,
      role: user.role,
    });
    res.json({
      accessToken: access,
      user: { id: user._id, name: user.name, role: user.role },
    });
  } catch (err) {
    logger.error("Login failed", { error: err.message });
    res.status(500).json({ message: "Login failed. Please try again." });
  }
});

/**
 * @swagger
 * /auth/refresh:
 *   post:
 *     summary: Refresh access token using refresh token from cookie
 *     tags: [Authentication]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Token refreshed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 accessToken:
 *                   type: string
 *                   description: New JWT access token
 *       401:
 *         description: Invalid or expired refresh token
 */
router.post("/refresh", async (req, res) => {
  try {
    const token = req.cookies?.jid;

    if (!token) {
      logger.warn("Token refresh failed: No refresh token provided");
      return res.status(401).json({ message: "Refresh token not found" });
    }

    logger.info("Attempting token refresh");

    const p = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    const user = await User.findById(p.sub);

    if (!user) {
      logger.warn("Token refresh failed: User not found", { userId: p.sub });
      return res.status(401).json({ message: "User not found" });
    }

    if (!user.isActive) {
      logger.warn("Token refresh failed: Account not active", {
        userId: user._id,
      });
      return res.status(401).json({ message: "Account not active" });
    }

    if (user.disabled) {
      logger.warn("Token refresh failed: Account disabled", {
        userId: user._id,
      });
      return res.status(401).json({ message: "Account disabled" });
    }

    const access = signAccess(user);
    logger.info("Token refreshed successfully", { userId: user._id });
    res.json({ accessToken: access });
  } catch (e) {
    logger.error("Token refresh failed", { error: e.message });
    return res
      .status(401)
      .json({ message: "Invalid or expired refresh token" });
  }
});

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: Logout user (clears refresh token cookie)
 *     tags: [Authentication]
 *     responses:
 *       200:
 *         description: Logged out successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 */
router.post("/logout", (req, res) => {
  try {
    logger.info("User logged out");
    res.clearCookie("jid", { path: "/" });
    res.json({ message: "Logged out successfully" });
  } catch (err) {
    logger.error("Logout failed", { error: err.message });
    res.status(500).json({ message: "Logout failed" });
  }
});

export default router;

// =============== OTP password reset ===============

async function sendMail(to, subject, text) {
  if (!process.env.MAIL_USER || !process.env.MAIL_PASS) {
    logger.warn("Email not configured", { to, subject });
    return;
  }

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS },
    });

    await transporter.sendMail({
      from: `"Interview Portal" <${process.env.MAIL_USER}>`,
      to,
      subject,
      text,
    });
    logger.info("Email sent successfully", { to, subject });
  } catch (err) {
    logger.error("Email send failed", { to, subject, error: err.message });
  }
}

/**
 * @swagger
 * /auth/request-reset-otp:
 *   post:
 *     summary: Request password reset OTP
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: OTP sent if account exists (generic response for security)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *       429:
 *         description: Too many OTP requests (rate limited)
 */
// Request OTP
router.post("/request-reset-otp", async (req, res) => {
  try {
    const { email } = req.body;
    const normalizedEmail = (email || "").trim().toLowerCase();

    logger.info("OTP request attempt", { email: normalizedEmail });

    if (!normalizedEmail) {
      logger.warn("OTP request failed: Missing email");
      return res.status(400).json({ message: "Email is required" });
    }

    // Check rate limiting
    if (!checkOtpRateLimit(normalizedEmail)) {
      logger.warn("OTP request blocked: Rate limit exceeded", {
        email: normalizedEmail,
      });
      return res
        .status(429)
        .json({ message: "Too many OTP requests. Please try again later." });
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      logger.info("OTP request for non-existent email", {
        email: normalizedEmail,
      });
      // Generic response to prevent email enumeration
      return res.status(200).json({ message: "If account exists, OTP sent" });
    }

    const code = "" + Math.floor(100000 + Math.random() * 900000); // 6 digits
    user.resetOtpCode = code;
    user.resetOtpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 min
    await user.save();

    logger.info("OTP generated and saved", {
      userId: user._id,
      email: user.email,
    });

    await sendMail(
      user.email,
      "Your password reset OTP",
      `Hello ${user.name},\n\nUse this OTP to reset your password: ${code}. It expires in 10 minutes.\n\nIf you did not request this, please ignore this email.\n\nRegards,\nInterview Portal`
    );

    res.status(200).json({ message: "OTP sent if account exists" });
  } catch (err) {
    logger.error("OTP request failed", { error: err.message });
    res.status(500).json({ message: "OTP request failed. Please try again." });
  }
});

/**
 * @swagger
 * /auth/verify-reset-otp:
 *   post:
 *     summary: Verify password reset OTP
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - otp
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               otp:
 *                 type: string
 *                 description: 6-digit OTP code
 *     responses:
 *       200:
 *         description: OTP verified successfully
 *       400:
 *         description: Invalid OTP or OTP expired
 */
// Verify OTP (optional step if you want explicit verification)
router.post("/verify-reset-otp", async (req, res) => {
  try {
    const { email, otp } = req.body;
    const normalizedEmail = (email || "").trim().toLowerCase();

    logger.info("OTP verification attempt", { email: normalizedEmail });

    if (!normalizedEmail || !otp) {
      logger.warn("OTP verification failed: Missing email or OTP");
      return res.status(400).json({ message: "Email and OTP are required" });
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (!user || !user.resetOtpCode || !user.resetOtpExpires) {
      logger.warn("OTP verification failed: No OTP request found", {
        email: normalizedEmail,
      });
      return res
        .status(400)
        .json({ message: "Invalid request. Please request an OTP first." });
    }

    if (user.resetOtpCode !== otp) {
      logger.warn("OTP verification failed: Invalid OTP", {
        email: normalizedEmail,
      });
      return res.status(400).json({ message: "Invalid OTP" });
    }

    if (Date.now() > new Date(user.resetOtpExpires).getTime()) {
      logger.warn("OTP verification failed: OTP expired", {
        email: normalizedEmail,
      });
      return res
        .status(400)
        .json({ message: "OTP has expired. Please request a new one." });
    }

    logger.info("OTP verified successfully", {
      userId: user._id,
      email: user.email,
    });
    res.json({ message: "OTP verified successfully" });
  } catch (err) {
    logger.error("OTP verification failed", { error: err.message });
    res
      .status(500)
      .json({ message: "OTP verification failed. Please try again." });
  }
});

/**
 * @swagger
 * /auth/reset-password:
 *   post:
 *     summary: Reset password using OTP
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - otp
 *               - newPassword
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               otp:
 *                 type: string
 *                 description: 6-digit OTP code
 *               newPassword:
 *                 type: string
 *                 minLength: 8
 *                 description: New password (minimum 8 characters)
 *     responses:
 *       200:
 *         description: Password reset successful
 *       400:
 *         description: Invalid OTP, expired OTP, or weak password
 */
// Reset password using OTP
router.post("/reset-password", async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    const normalizedEmail = (email || "").trim().toLowerCase();

    logger.info("Password reset attempt", { email: normalizedEmail });

    if (!normalizedEmail || !otp || !newPassword) {
      logger.warn("Password reset failed: Missing required fields", {
        email: normalizedEmail,
      });
      return res
        .status(400)
        .json({ message: "Email, OTP, and new password are required" });
    }

    // Validate password strength
    const passwordValidation = validatePassword(newPassword);
    if (!passwordValidation.valid) {
      logger.warn("Password reset failed: Weak password", {
        email: normalizedEmail,
      });
      return res.status(400).json({ message: passwordValidation.message });
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (!user || !user.resetOtpCode || !user.resetOtpExpires) {
      logger.warn("Password reset failed: No OTP request found", {
        email: normalizedEmail,
      });
      return res
        .status(400)
        .json({ message: "Invalid request. Please request an OTP first." });
    }

    if (user.resetOtpCode !== otp) {
      logger.warn("Password reset failed: Invalid OTP", {
        email: normalizedEmail,
      });
      return res.status(400).json({ message: "Invalid OTP" });
    }

    if (Date.now() > new Date(user.resetOtpExpires).getTime()) {
      logger.warn("Password reset failed: OTP expired", {
        email: normalizedEmail,
      });
      return res
        .status(400)
        .json({ message: "OTP has expired. Please request a new one." });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    user.password = hash;
    user.resetOtpCode = undefined;
    user.resetOtpExpires = undefined;
    await user.save();

    logger.info("Password reset successfully", {
      userId: user._id,
      email: user.email,
    });

    // Optional: Send confirmation email
    await sendMail(
      user.email,
      "Password Reset Confirmation",
      `Hello ${user.name},\n\nYour password has been successfully reset.\n\nIf you did not perform this action, please contact support immediately.\n\nRegards,\nInterview Portal`
    );

    res.json({
      message:
        "Password reset successful. You can now login with your new password.",
    });
  } catch (err) {
    logger.error("Password reset failed", { error: err.message });
    res
      .status(500)
      .json({ message: "Password reset failed. Please try again." });
  }
});
