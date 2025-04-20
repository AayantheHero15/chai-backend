import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { User } from "../models/user.model.js";
import { uploadOnCloudinary, deleteFromCloudinary } from "../utils/cloudinary.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import jwt from 'jsonwebtoken';
import mongoose, { isValidObjectId } from "mongoose";
import { Subscription } from "../models/subscription.model.js"; // Import Subscription model

// Utility function to generate tokens
const generateAccessAndRefreshToken = async (userId) => {
  try {
    const user = await User.findById(userId);
    if (!user) {
      throw new ApiError(404, "User not found while generating tokens");
    }
    const accessToken = user.generateAccessToken();
    const refreshToken = user.generateRefreshToken();

    user.refreshToken = refreshToken;
    await user.save({ validateBeforeSave: false });

    return { accessToken, refreshToken };
  } catch (error) {
    // Log the actual error for debugging
    console.error("Token generation error:", error);
    // Avoid exposing internal details in the error message if possible
    throw new ApiError(500, error?.message || "Something went wrong while generating refresh and access tokens");
  }
};

// Cookie options
const cookieOptions = {
  httpOnly: true, // Prevent client-side JS access
  secure: process.env.NODE_ENV === 'production', // Use secure cookies in production
  sameSite: 'Strict' // Mitigate CSRF attacks
};

// Controller for user registration
const registerUser = asyncHandler(async (req, res) => {
  const { fullName, email, username, password } = req.body;

  // 1. Validate input
  if (!fullName?.trim() || !email?.trim() || !username?.trim() || !password?.trim()) {
    throw new ApiError(400, "All fields (fullName, email, username, password) are required");
  }

  // Basic email format validation
  if (!/\S+@\S+\.\S+/.test(email)) {
    throw new ApiError(400, "Invalid email format");
  }

  // 2. Check if user already exists
  const existedUser = await User.findOne({
    $or: [{ username: username.toLowerCase() }, { email: email.toLowerCase() }]
  }).lean(); // Use lean() for performance

  if (existedUser) {
    throw new ApiError(409, "User with this email or username already exists");
  }

  // 3. Handle file uploads (Avatar required, Cover Image optional)
  const avatarLocalPath = req.files?.avatar?.[0]?.path;
  const coverImageLocalPath = req.files?.coverImage?.[0]?.path;

  if (!avatarLocalPath) {
    throw new ApiError(400, "Avatar image is required");
  }

  const avatar = await uploadOnCloudinary(avatarLocalPath);
  const coverImage = coverImageLocalPath ? await uploadOnCloudinary(coverImageLocalPath) : null;

  if (!avatar?.url) { // Check if URL exists after upload
    throw new ApiError(500, "Failed to upload avatar image");
  }

  // 4. Create user in DB
  let user;
  try {
    user = await User.create({
      fullName: fullName.trim(),
      avatar: avatar.url,
      coverImage: coverImage?.url || "", // Default to empty string
      email: email.toLowerCase().trim(),
      password, // Hashing handled by pre-save hook
      username: username.toLowerCase().trim()
    });
  } catch (dbError) {
    // If DB creation fails, attempt to delete uploaded files
    if (avatar?.public_id) await deleteFromCloudinary(avatar.public_id).catch(err => console.error("Failed to delete avatar after DB error:", err));
    if (coverImage?.public_id) await deleteFromCloudinary(coverImage.public_id).catch(err => console.error("Failed to delete cover image after DB error:", err));
    throw new ApiError(500, `Database error during user registration: ${dbError.message}`);
  }

  // 5. Fetch created user (excluding sensitive fields)
  const createdUser = await User.findById(user._id).select("-password -refreshToken");

  if (!createdUser) {
    // This case is less likely if create() succeeded, but handle defensively
    throw new ApiError(500, "Something went wrong while fetching the registered user details");
  }

  // 6. Return response
  return res.status(201).json(new ApiResponse(201, createdUser, "User registered Successfully"));
});

// Controller for user login
const loginUser = asyncHandler(async (req, res) => {
  const { email, username, password } = req.body;

  // 1. Validate input
  if (!password) {
    throw new ApiError(400, "Password is required");
  }
  if (!email && !username) {
    throw new ApiError(400, "Username or email is required");
  }

  // 2. Find user (include password for comparison)
  const user = await User.findOne({
    $or: [
      { username: username?.toLowerCase() },
      { email: email?.toLowerCase() }
    ]
  });

  if (!user) {
    throw new ApiError(404, "User does not exist");
  }

  // 3. Validate password
  const isPasswordValid = await user.isPasswordCorrect(password);
  if (!isPasswordValid) {
    throw new ApiError(401, "Invalid user credentials");
  }

  // 4. Generate tokens
  const { accessToken, refreshToken } = await generateAccessAndRefreshToken(user._id);

  // 5. Fetch logged-in user details (excluding sensitive fields)
  const loggedInUser = await User.findById(user._id).select("-password -refreshToken");

  // 6. Send tokens via cookies and response body
  return res
    .status(200)
    .cookie("accessToken", accessToken, cookieOptions)
    .cookie("refreshToken", refreshToken, cookieOptions)
    .json(new ApiResponse(
      200,
      { user: loggedInUser, accessToken, refreshToken },
      "User logged in successfully"
    ));
});

// Controller for user logout
const logoutUser = asyncHandler(async (req, res) => {
  // Clear the refresh token in the database
  await User.findByIdAndUpdate(
    req.user._id,
    {
      $set: { // Set refreshToken to undefined or null
        refreshToken: undefined
      }
    },
    { new: true } // Optional: return updated doc
  );

  // Clear cookies on the client side
  return res
    .status(200)
    .clearCookie("accessToken", cookieOptions)
    .clearCookie("refreshToken", cookieOptions)
    .json(new ApiResponse(200, {}, "User logged out successfully"));
});

// Controller to refresh access token
const refreshAccessToken = asyncHandler(async (req, res) => {
  // 1. Get refresh token (from cookies or body)
  const incomingRefreshToken = req.cookies.refreshToken || req.body.refreshToken;

  if (!incomingRefreshToken) {
    throw new ApiError(401, "Unauthorized request: Refresh token is missing");
  }

  try {
    // 2. Verify the refresh token
    const decodedToken = jwt.verify(incomingRefreshToken, process.env.REFRESH_TOKEN_SECRET);

    // 3. Find user based on decoded token ID
    const user = await User.findById(decodedToken?._id);
    if (!user) {
      throw new ApiError(401, "Invalid refresh token: User not found");
    }

    // 4. Check if the incoming token matches the one stored in DB
    if (incomingRefreshToken !== user?.refreshToken) {
      // If tokens don't match, it might indicate token reuse or compromise
      // Consider invalidating all tokens for this user as a security measure
      throw new ApiError(401, "Refresh token is expired or used");
    }

    // 5. Generate new pair of tokens
    const { accessToken, refreshToken: newRefreshToken } = await generateAccessAndRefreshToken(user._id);

    // 6. Send new tokens via cookies and response
    return res
      .status(200)
      .cookie("accessToken", accessToken, cookieOptions)
      .cookie("refreshToken", newRefreshToken, cookieOptions)
      .json(
        new ApiResponse(
          200,
          { accessToken, refreshToken: newRefreshToken }, // Send new refresh token back
          "Access Token Refreshed Successfully"
        )
      );
  } catch (error) {
    // Handle specific JWT errors
    if (error instanceof jwt.TokenExpiredError) {
      throw new ApiError(401, "Refresh token expired");
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw new ApiError(401, "Invalid refresh token");
    }
    // Rethrow other ApiErrors or wrap unexpected errors
    if (error instanceof ApiError) {
        throw error;
    }
    console.error("Refresh token error:", error);
    throw new ApiError(401, error?.message || "Invalid refresh token");
  }
});

// Controller to change current password
const changeCurrentPassword = asyncHandler(async (req, res) => {
  const { oldPassword, newPassword } = req.body;

  // 1. Validate input
  if (!oldPassword || !newPassword) {
    throw new ApiError(400, "Old and new passwords are required");
  }
  if (oldPassword === newPassword) {
    throw new ApiError(400, "New password cannot be the same as the old password");
  }

  // 2. Find user (requires password field)
  const user = await User.findById(req.user?._id);
  if (!user) {
      throw new ApiError(404, "User not found"); // Should not happen if authenticated
  }

  // 3. Verify old password
  const isPasswordCorrect = await user.isPasswordCorrect(oldPassword);
  if (!isPasswordCorrect) {
    throw new ApiError(400, "Incorrect old password");
  }

  // 4. Update password (pre-save hook handles hashing)
  user.password = newPassword;
  await user.save({ validateBeforeSave: false }); // Skip validation if only password changes

  // 5. Return success response
  return res
    .status(200)
    .json(new ApiResponse(200, {}, "Password changed successfully"));
});

// Controller to get current logged-in user details
const getCurrentUser = asyncHandler(async (req, res) => {
  // req.user is populated by the auth middleware
  if (!req.user) {
      throw new ApiError(401, "Unauthorized request");
  }
  return res
    .status(200)
    .json(new ApiResponse(200, req.user, "User fetched successfully"));
});

// Controller to update account details (fullName, email)
const updateAccountDetails = asyncHandler(async (req, res) => {
  const { fullName, email } = req.body;

  // 1. Validate input (at least one field required)
  if (!fullName?.trim() && !email?.trim()) {
    throw new ApiError(400, "At least one field (fullName or email) is required to update");
  }

  // 2. Prepare update object
  const updateData = {};
  if (fullName?.trim()) {
    updateData.fullName = fullName.trim();
  }
  if (email?.trim()) {
    const normalizedEmail = email.toLowerCase().trim();
    // Basic email format validation
    if (!/\S+@\S+\.\S+/.test(normalizedEmail)) {
      throw new ApiError(400, "Invalid email format");
    }
    // Check if the new email is already taken by another user
    const emailExists = await User.findOne({ email: normalizedEmail, _id: { $ne: req.user?._id } });
    if (emailExists) {
        throw new ApiError(409, "Email already in use by another account");
    }
    updateData.email = normalizedEmail;
  }

  // 3. Find and update user
  const user = await User.findByIdAndUpdate(
    req.user?._id,
    {
      $set: updateData
    },
    { new: true } // Return the updated document
  ).select("-password -refreshToken");

  if (!user) {
    throw new ApiError(404, "User not found"); // Should not happen if authenticated
  }

  // 4. Return updated user details
  return res
    .status(200)
    .json(new ApiResponse(200, user, "Account details updated successfully"));
});

// Helper function to safely delete from Cloudinary
const safeDeleteFromCloudinary = async (publicId, resourceType = 'image') => {
    if (!publicId) return;
    try {
        await deleteFromCloudinary(publicId, resourceType);
        console.log(`Successfully deleted ${resourceType} from Cloudinary: ${publicId}`);
    } catch (error) {
        console.error(`Failed to delete ${resourceType} from Cloudinary (${publicId}):`, error);
        // Optionally: Add to a cleanup queue or monitoring
    }
};

// Controller to update user avatar
const updateUserAvatar = asyncHandler(async (req, res) => {
  // 1. Get file path
  const avatarLocalPath = req.file?.path;
  if (!avatarLocalPath) {
    throw new ApiError(400, "Avatar image file is missing");
  }

  // 2. Upload new avatar
  const avatar = await uploadOnCloudinary(avatarLocalPath);
  if (!avatar?.url) {
    throw new ApiError(500, "Error while uploading avatar image");
  }

  // 3. Update user document
  const oldAvatarUrl = req.user?.avatar; // Store old URL before updating
  const user = await User.findByIdAndUpdate(
    req.user?._id,
    {
      $set: {
        avatar: avatar.url // Update with the new URL
      }
    },
    { new: true }
  ).select("-password -refreshToken");

  if (!user) {
    // If DB update fails, try to delete the newly uploaded avatar
    await safeDeleteFromCloudinary(avatar.public_id);
    throw new ApiError(500, "Failed to update avatar in database");
  }

  // 4. Delete old avatar from Cloudinary (AFTER successful DB update)
  if (oldAvatarUrl && oldAvatarUrl !== avatar.url) {
    const urlParts = oldAvatarUrl.split('/');
    const publicIdWithExtension = urlParts[urlParts.length - 1];
    const oldAvatarPublicId = publicIdWithExtension.split('.')[0];
    await safeDeleteFromCloudinary(oldAvatarPublicId);
  }

  // 5. Return response
  return res
    .status(200)
    .json(new ApiResponse(200, user, "Avatar updated successfully"));
});

// Controller to update user cover image
const updateUserCoverImage = asyncHandler(async (req, res) => {
  // 1. Get file path
  const coverImageLocalPath = req.file?.path;
  if (!coverImageLocalPath) {
    throw new ApiError(400, "Cover image file is missing");
  }

  // 2. Upload new cover image
  const coverImage = await uploadOnCloudinary(coverImageLocalPath);
  if (!coverImage?.url) {
    throw new ApiError(500, "Error while uploading cover image");
  }

  // 3. Update user document
  const oldCoverImageUrl = req.user?.coverImage; // Store old URL
  const user = await User.findByIdAndUpdate(
    req.user?._id,
    {
      $set: {
        coverImage: coverImage.url // Update with the new URL
      }
    },
    { new: true }
  ).select("-password -refreshToken");

  if (!user) {
    // If DB update fails, try to delete the newly uploaded image
    await safeDeleteFromCloudinary(coverImage.public_id);
    throw new ApiError(500, "Failed to update cover image in database");
  }

  // 4. Delete old cover image from Cloudinary (AFTER successful DB update)
  if (oldCoverImageUrl && oldCoverImageUrl !== coverImage.url) {
    const urlParts = oldCoverImageUrl.split('/');
    const publicIdWithExtension = urlParts[urlParts.length - 1];
    const oldCoverImagePublicId = publicIdWithExtension.split('.')[0];
    await safeDeleteFromCloudinary(oldCoverImagePublicId);
  }

  // 5. Return response
  return res
    .status(200)
    .json(new ApiResponse(200, user, "Cover Image updated successfully"));
});

// Controller to get user channel profile
const getUserChannelProfile = asyncHandler(async (req, res) => {
  const { username } = req.params;

  if (!username?.trim()) {
    throw new ApiError(400, "Username is required");
  }

  const pipeline = [
    {
      $match: {
        username: username.toLowerCase() // Case-insensitive match
      }
    },
    {
      $lookup: {
        from: "subscriptions",
        localField: "_id",
        foreignField: "channel",
        as: "subscribers"
      }
    },
    {
      $lookup: {
        from: "subscriptions",
        localField: "_id",
        foreignField: "subscriber",
        as: "subscribedTo"
      }
    },
    {
      $addFields: {
        subscribersCount: { $size: "$subscribers" },
        channelsSubscribedToCount: { $size: "$subscribedTo" },
        // Check if the *requesting* user is subscribed to *this* channel
        isSubscribed: {
          $cond: {
            if: { $in: [req.user?._id, "$subscribers.subscriber"] },
            then: true,
            else: false
          }
        }
      }
    },
    {
      $project: {
        fullName: 1,
        username: 1,
        avatar: 1,
        coverImage: 1,
        email: 1, // Consider if email should be public
        subscribersCount: 1,
        channelsSubscribedToCount: 1,
        isSubscribed: 1,
        createdAt: 1,
        updatedAt: 1
      }
    }
  ];

  const channel = await User.aggregate(pipeline);

  if (!channel?.length) {
    throw new ApiError(404, "Channel not found");
  }

  return res
    .status(200)
    .json(new ApiResponse(200, channel[0], "User channel profile fetched successfully"));
});

// Controller to get user watch history
const getWatchHistory = asyncHandler(async (req, res) => {
  if (!req.user?._id) {
    throw new ApiError(401, "Unauthorized request");
  }

  // TODO: Add pagination (page, limit)

  const userWithHistory = await User.aggregate([
    {
      $match: {
        _id: new mongoose.Types.ObjectId(req.user._id)
      }
    },
    {
      $lookup: {
        from: "videos",
        localField: "watchHistory", // Assuming watchHistory stores video ObjectIds
        foreignField: "_id",
        as: "watchHistoryDetails",
        pipeline: [
          {
            $match: { isPublished: true } // Only show published videos in history
          },
          {
            $lookup: {
              from: "users",
              localField: "owner",
              foreignField: "_id",
              as: "ownerDetails",
              pipeline: [
                {
                  $project: {
                    username: 1,
                    avatar: 1
                  }
                }
              ]
            }
          },
          {
            $addFields: {
              ownerDetails: { $first: "$ownerDetails" }
            }
          },
          {
            $project: { // Select necessary fields for history items
                _id: 1,
                videoFile: 1, // or use thumbnail
                thumbnail: 1,
                title: 1,
                duration: 1,
                views: 1,
                createdAt: 1,
                ownerDetails: 1
            }
          },
          { $sort: { createdAt: -1 } } // Optional: sort videos within history
        ]
      }
    },
    {
        $project: {
            _id: 1,
            watchHistory: "$watchHistoryDetails" // Rename field
        }
    }
  ]);

  const watchHistory = userWithHistory[0]?.watchHistory || [];

  return res
    .status(200)
    .json(new ApiResponse(200, watchHistory, "Watch History fetched successfully"));
});

export {
  registerUser,
  loginUser,
  logoutUser,
  refreshAccessToken,
  changeCurrentPassword,
  getCurrentUser,
  updateAccountDetails,
  updateUserAvatar,
  updateUserCoverImage,
  getUserChannelProfile,
  getWatchHistory
};
