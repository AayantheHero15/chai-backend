import mongoose, { isValidObjectId } from "mongoose"
import { Like } from "../models/like.model.js"
import { ApiError } from "../utils/ApiError.js"
import { ApiResponse } from "../utils/ApiResponse.js"
import { asyncHandler } from "../utils/asyncHandler.js"

const toggleVideoLike = asyncHandler(async (req, res) => {
    const { videoId } = req.params
    if (!isValidObjectId(videoId)) {
        throw new ApiError(400, "Invalid video ID");
    }

    if (!req.user?._id) {
        throw new ApiError(401, "Unauthorized request");
    }

    const existingLike = await Like.findOne({
        video: videoId,
        likedBy: req.user._id
    })

    if (existingLike) {
        const deletedLike = await Like.findByIdAndDelete(existingLike._id);
        if (!deletedLike) {
            throw new ApiError(500, "Failed to unlike video");
        }
        return res.status(200).json(
            new ApiResponse(200, { isLiked: false }, "Video unliked successfully")
        );
    }

    const like = await Like.create({
        video: videoId,
        likedBy: req.user._id
    });

    if (!like) {
        throw new ApiError(500, "Failed to like video");
    }

    return res.status(201).json(
        new ApiResponse(201, { isLiked: true, like }, "Video liked successfully")
    );
});

const toggleCommentLike = asyncHandler(async (req, res) => {
    const { commentId } = req.params
    if (!isValidObjectId(commentId)) {
        throw new ApiError(400, "Invalid comment ID");
    }

    if (!req.user?._id) {
        throw new ApiError(401, "Unauthorized request");
    }

    const existingLike = await Like.findOne({
        comment: commentId,
        likedBy: req.user._id
    })

    if (existingLike) {
        const deletedLike = await Like.findByIdAndDelete(existingLike._id);
        if (!deletedLike) {
            throw new ApiError(500, "Failed to unlike comment");
        }
        return res.status(200).json(
            new ApiResponse(200, { isLiked: false }, "Comment unliked successfully")
        );
    }

    const like = await Like.create({
        comment: commentId,
        likedBy: req.user._id
    });

    if (!like) {
        throw new ApiError(500, "Failed to like comment");
    }

    return res.status(201).json(
        new ApiResponse(201, { isLiked: true, like }, "Comment liked successfully")
    );
});

const toggleTweetLike = asyncHandler(async (req, res) => {
    const { tweetId } = req.params
    if (!isValidObjectId(tweetId)) {
        throw new ApiError(400, "Invalid tweet ID");
    }

    if (!req.user?._id) {
        throw new ApiError(401, "Unauthorized request");
    }

    const existingLike = await Like.findOne({
        tweet: tweetId,
        likedBy: req.user._id
    })

    if (existingLike) {
        const deletedLike = await Like.findByIdAndDelete(existingLike._id);
        if (!deletedLike) {
            throw new ApiError(500, "Failed to unlike tweet");
        }
        return res.status(200).json(
            new ApiResponse(200, { isLiked: false }, "Tweet unliked successfully")
        );
    }

    const like = await Like.create({
        tweet: tweetId,
        likedBy: req.user._id
    });

    if (!like) {
        throw new ApiError(500, "Failed to like tweet");
    }

    return res.status(201).json(
        new ApiResponse(201, { isLiked: true, like }, "Tweet liked successfully")
    );
});

const getLikedVideos = asyncHandler(async (req, res) => {
    if (!req.user?._id) {
        throw new ApiError(401, "Unauthorized request");
    }

    const likedVideosPipeline = [
        {
            $match: {
                likedBy: new mongoose.Types.ObjectId(req.user._id),
                video: { $exists: true, $ne: null } // Ensure video field exists and is not null
            }
        },
        {
            $lookup: {
                from: "videos",
                localField: "video",
                foreignField: "_id",
                as: "videoDetails",
                pipeline: [
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
                        $project: { // Select necessary video fields
                            _id: 1,
                            videoFile: 1,
                            thumbnail: 1,
                            title: 1,
                            duration: 1,
                            views: 1,
                            createdAt: 1,
                            ownerDetails: 1
                        }
                    }
                ]
            }
        },
        {
            $addFields: {
                videoDetails: { $first: "$videoDetails" }
            }
        },
        {
            $match: {
                videoDetails: { $ne: null } // Filter out likes where the video might have been deleted
            }
        },
        {
            $replaceRoot: { newRoot: "$videoDetails" } // Promote video details to the root level
        },
        {
            $sort: { createdAt: -1 } // Sort liked videos by when the video was created
        }
    ];

    const likedVideos = await Like.aggregate(likedVideosPipeline);

    return res.status(200).json(
        new ApiResponse(200, likedVideos, "Liked videos fetched successfully")
    );
});

export {
    toggleCommentLike,
    toggleTweetLike,
    toggleVideoLike,
    getLikedVideos
}