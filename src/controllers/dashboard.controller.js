import mongoose from "mongoose"
import { Video } from "../models/video.model.js"
import { Subscription } from "../models/subscription.model.js"
import { Like } from "../models/like.model.js"
import { ApiError } from "../utils/ApiError.js"
import { ApiResponse } from "../utils/ApiResponse.js"
import mongoose, { isValidObjectId } from "mongoose"
import { Video } from "../models/video.model.js"
import { Subscription } from "../models/subscription.model.js"
import { Like } from "../models/like.model.js"
import { ApiError } from "../utils/ApiError.js"
import { ApiResponse } from "../utils/ApiResponse.js"
import { asyncHandler } from "../utils/asyncHandler.js"

const getChannelStats = asyncHandler(async (req, res) => {
    if (!req.user?._id) {
        throw new ApiError(401, "Unauthorized request");
    }

    // Define the aggregation pipeline for channel stats
    const stats = await Video.aggregate([
        {
            $match: {
                owner: new mongoose.Types.ObjectId(req.user._id)
            }
        },
        {
            $lookup: {
                from: "likes",
                localField: "_id",
                foreignField: "video",
                as: "likes"
            }
        },
        {
            $lookup: {
                from: "subscriptions",
                localField: "owner",
                foreignField: "channel",
                as: "subscribers"
            }
        },
        {
            $group: {
                _id: null,
                totalVideos: { $sum: 1 },
                totalViews: { $sum: "$views" },
                totalLikes: { $sum: { $size: "$likes" } },
                totalSubscribers: { $first: { $size: "$subscribers" } }
            }
        },
        {
            $project: {
                _id: 0, // Exclude the default _id field
                totalVideos: 1,
                totalViews: 1,
                totalLikes: 1,
                totalSubscribers: 1
            }
        },
        {
            $project: { // Select necessary fields
                _id: 1,
                videoFile: 1,
                thumbnail: 1,
                title: 1,
                description: 1,
                duration: 1,
                views: 1,
                isPublished: 1,
                createdAt: 1,
                likesCount: 1
                // Exclude the 'likes' array unless needed
            }
        },
        {
            $sort: {
                createdAt: -1 // Sort by newest first
            }
        },
        {
            $skip: (pageNumber - 1) * limitNumber
        },
        {
            $limit: limitNumber
        }
    ]);

    // Get total count for pagination metadata
    const totalVideos = await Video.countDocuments({ owner: req.user._id });;

    // Handle the case where the user might not have any videos yet
    const channelStats = stats[0] || {
        totalVideos: 0,
        totalViews: 0,
        totalLikes: 0,
        totalSubscribers: 0 // Need to fetch subscriber count separately if no videos exist
    };

    // If no videos, fetch subscriber count separately
    if (stats.length === 0) {
        const subscriberCount = await Subscription.countDocuments({ channel: req.user._id });
        channelStats.totalSubscribers = subscriberCount;
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            channelStats,
            "Channel stats fetched successfully"
        )
    );
});

const getChannelVideos = asyncHandler(async (req, res) => {
    const { page = 1, limit = 10 } = req.query;

    if (!req.user?._id) {
        throw new ApiError(401, "Unauthorized request");
    }

    // Convert page and limit to numbers, ensure they are positive integers
    const pageNumber = parseInt(page, 10);
    const limitNumber = parseInt(limit, 10);

    if (isNaN(pageNumber) || pageNumber < 1 || isNaN(limitNumber) || limitNumber < 1) {
        throw new ApiError(400, "Invalid page or limit parameters");
    }

    // Define the aggregation pipeline for fetching channel videos
    const videos = await Video.aggregate([
        {
            $match: {
                owner: new mongoose.Types.ObjectId(req.user._id)
            }
        },
        {
            $lookup: {
                from: "likes",
                localField: "_id",
                foreignField: "video",
                as: "likes"
            }
        },
        {
            $addFields: {
                likesCount: { $size: "$likes" }
            }
        },
        {
            $project: {
                likes: 0
            }
        },
        {
            $sort: {
                createdAt: -1
            }
        },
        {
            $project: {
                _id: 0, // Exclude the default _id field
                totalVideos: 1,
                totalViews: 1,
                totalLikes: 1,
                totalSubscribers: 1
            }
        },
        {
            $project: { // Select necessary fields
                _id: 1,
                videoFile: 1,
                thumbnail: 1,
                title: 1,
                description: 1,
                duration: 1,
                views: 1,
                isPublished: 1,
                createdAt: 1,
                likesCount: 1
                // Exclude the 'likes' array unless needed
            }
        },
        {
            $sort: {
                createdAt: -1 // Sort by newest first
            }
        },
        {
            $skip: (pageNumber - 1) * limitNumber
        },
        {
            $limit: limitNumber
        }
    ]);

    // Get total count for pagination metadata
    const totalVideos = await Video.countDocuments({ owner: req.user._id });;

    // Handle the case where the user might not have any videos yet
    const channelStats = stats[0] || {
        totalVideos: 0,
        totalViews: 0,
        totalLikes: 0,
        totalSubscribers: 0 // Need to fetch subscriber count separately if no videos exist
    };

    // If no videos, fetch subscriber count separately
    if (stats.length === 0) {
        const subscriberCount = await Subscription.countDocuments({ channel: req.user._id });
        channelStats.totalSubscribers = subscriberCount;
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            { videos, totalVideos, page: pageNumber, limit: limitNumber, totalPages: Math.ceil(totalVideos / limitNumber) },
            "Channel videos fetched successfully"
        )
    );
});

export {
    getChannelStats,
    getChannelVideos
}