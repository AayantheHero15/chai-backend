import mongoose, { isValidObjectId } from "mongoose";
import { Tweet } from "../models/tweet.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { User } from "../models/user.model.js"; // Import User model if needed for checks
import { Like } from "../models/like.model.js"; // Import Like model for deletion

// Helper function (optional, consider if needed elsewhere or inline)
const getTweetWithDetails = async (tweetId, userId = null) => {
    if (!isValidObjectId(tweetId)) {
        throw new ApiError(400, "Invalid tweet ID");
    }
    const pipeline = [
        {
            $match: {
                _id: new mongoose.Types.ObjectId(tweetId)
            }
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
            $lookup: {
                from: "likes",
                localField: "_id",
                foreignField: "tweet",
                as: "likes"
            }
        },
        {
            $addFields: {
                ownerDetails: { $first: "$ownerDetails" },
                likesCount: { $size: "$likes" },
                isLiked: {
                    $cond: {
                        if: { $in: [userId ? new mongoose.Types.ObjectId(userId) : null, "$likes.likedBy"] },
                        then: true,
                        else: false
                    }
                }
            }
        },
        {
            $project: {
                content: 1,
                createdAt: 1,
                ownerDetails: 1,
                likesCount: 1,
                isLiked: 1
            }
        }
    ];
    const result = await Tweet.aggregate(pipeline);
    return result; // Returns an array
};

const createTweet = asyncHandler(async (req, res) => {
    const { content } = req.body;

    if (!content?.trim()) {
        throw new ApiError(400, "Content is required");
    }

    if (!req.user?._id) {
        throw new ApiError(401, "Unauthorized request");
    }

    const tweet = await Tweet.create({
        content: content.trim(),
        owner: req.user._id
    });

    if (!tweet) {
        throw new ApiError(500, "Failed to create tweet");
    }

    // Fetch details after creation using the helper or an optimized pipeline
    const tweetDetails = await getTweetWithDetails(tweet._id, req.user._id);

    if (!tweetDetails || tweetDetails.length === 0) {
        // Fallback if helper fails
        const createdTweet = await Tweet.findById(tweet._id).populate('owner', 'username avatar');
        if (!createdTweet) throw new ApiError(500, "Failed to fetch tweet details after creation");
        return res.status(201).json(
            new ApiResponse(201, { ...createdTweet.toObject(), likesCount: 0, isLiked: false }, "Tweet created successfully")
        );
    }

    return res.status(201).json(
        new ApiResponse(201, tweetDetails[0], "Tweet created successfully")
    );
});

const getUserTweets = asyncHandler(async (req, res) => {
    const { userId } = req.params;
    // TODO: Add pagination (page, limit)
    // const { page = 1, limit = 10 } = req.query;

    if (!isValidObjectId(userId)) {
        throw new ApiError(400, "Invalid user ID");
    }

    const pipeline = [
        {
            $match: {
                owner: new mongoose.Types.ObjectId(userId)
            }
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
            $lookup: {
                from: "likes",
                localField: "_id",
                foreignField: "tweet",
                as: "likes"
            }
        },
        {
            $addFields: {
                ownerDetails: { $first: "$ownerDetails" },
                likesCount: { $size: "$likes" },
                isLiked: {
                    $cond: {
                        if: { $in: [req.user?._id, "$likes.likedBy"] }, // Check if logged-in user liked
                        then: true,
                        else: false
                    }
                }
            }
        },
        {
            $sort: { createdAt: -1 } // Sort by newest first
        },
        {
            $project: { // Select final fields
                content: 1,
                createdAt: 1,
                ownerDetails: 1,
                likesCount: 1,
                isLiked: 1
            }
        }
        // TODO: Add pagination stages ($skip, $limit) here if implementing
    ];

    const tweets = await Tweet.aggregate(pipeline);

    if (!tweets) {
        // This case is unlikely with aggregate unless there's a major DB error
        throw new ApiError(500, "Failed to fetch user tweets");
    }

    return res.status(200).json(
        new ApiResponse(200, tweets, "User tweets fetched successfully")
    );
});

const updateTweet = asyncHandler(async (req, res) => {
    const { tweetId } = req.params;
    const { content } = req.body;

    if (!isValidObjectId(tweetId)) {
        throw new ApiError(400, "Invalid tweet ID");
    }

    if (!content?.trim()) {
        throw new ApiError(400, "Content is required");
    }

    if (!req.user?._id) {
        throw new ApiError(401, "Unauthorized request");
    }

    const tweet = await Tweet.findOneAndUpdate(
        {
            _id: new mongoose.Types.ObjectId(tweetId),
            owner: req.user._id // Ensure only the owner can update
        },
        {
            $set: {
                content: content.trim()
            }
        },
        { new: true } // Return the updated document
    );

    if (!tweet) {
        // Could be not found OR user is not the owner
        throw new ApiError(404, "Tweet not found or you don't have permission to update it");
    }

    // Fetch details after update to include owner info etc.
    const tweetDetails = await getTweetWithDetails(tweet._id, req.user._id);

    if (!tweetDetails || tweetDetails.length === 0) {
        // Fallback if helper fails
        const updatedTweet = await Tweet.findById(tweet._id).populate('owner', 'username avatar');
        if (!updatedTweet) throw new ApiError(500, "Failed to fetch tweet details after update");
        // Manually add like info if needed, though it might be complex here
        return res.status(200).json(new ApiResponse(200, updatedTweet, "Tweet updated successfully"));
    }

    return res.status(200).json(
        new ApiResponse(200, tweetDetails[0], "Tweet updated successfully")
    );
});

const deleteTweet = asyncHandler(async (req, res) => {
    const { tweetId } = req.params;

    if (!isValidObjectId(tweetId)) {
        throw new ApiError(400, "Invalid tweet ID");
    }

    if (!req.user?._id) {
        throw new ApiError(401, "Unauthorized request");
    }

    const tweet = await Tweet.findOneAndDelete({
        _id: new mongoose.Types.ObjectId(tweetId),
        owner: req.user._id // Ensure only the owner can delete
    });

    if (!tweet) {
        // Could be not found OR user is not the owner
        throw new ApiError(404, "Tweet not found or you don't have permission to delete it");
    }

    // Delete associated likes for this tweet
    try {
        await Like.deleteMany({ tweet: tweetId });
    } catch (error) {
        // Log the error but don't block the response
        console.error(`Failed to delete likes for tweet ${tweetId}:`, error);
    }


    return res.status(200).json(
        new ApiResponse(200, { deletedTweetId: tweetId }, "Tweet deleted successfully")
    );
});

export {
    createTweet,
    getUserTweets,
    updateTweet,
    deleteTweet
};
