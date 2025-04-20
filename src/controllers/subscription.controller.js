import mongoose, { isValidObjectId } from "mongoose"
import { User } from "../models/user.model.js"
import { Subscription } from "../models/subscription.model.js"
import { ApiError } from "../utils/ApiError.js"
import { ApiResponse } from "../utils/ApiResponse.js"
import mongoose, { isValidObjectId } from "mongoose"
import { User } from "../models/user.model.js"
import { Subscription } from "../models/subscription.model.js"
import { ApiError } from "../utils/ApiError.js"
import { ApiResponse } from "../utils/ApiResponse.js"
import { asyncHandler } from "../utils/asyncHandler.js"


const toggleSubscription = asyncHandler(async (req, res) => {
    const { channelId } = req.params;

    if (!isValidObjectId(channelId)) {
        throw new ApiError(400, "Invalid channel ID");
    }

    if (!req.user?._id) {
        throw new ApiError(401, "Unauthorized request");
    }

    // Prevent self-subscription
    if (channelId === req.user._id.toString()) {
        throw new ApiError(400, "You cannot subscribe to your own channel");
    }

    // Check if the channel exists
    const channelExists = await User.findById(channelId);
    if (!channelExists) {
        throw new ApiError(404, "Channel not found");
    }

    const existingSubscription = await Subscription.findOne({
        subscriber: req.user._id,
        channel: channelId
    })

    if (existingSubscription) {
        const deletedSubscription = await Subscription.findByIdAndDelete(existingSubscription._id);
        if (!deletedSubscription) {
            throw new ApiError(500, "Failed to unsubscribe");
        }
        return res.status(200).json(
            new ApiResponse(200, { isSubscribed: false }, "Unsubscribed successfully")
        );
    }

    const newSubscription = await Subscription.create({
        subscriber: req.user._id,
        channel: channelId
    });

    if (!newSubscription) {
        throw new ApiError(500, "Failed to subscribe");
    }

    return res.status(201).json( // Use 201 for resource creation
        new ApiResponse(201, { isSubscribed: true }, "Subscribed successfully")
    );
});

// Controller to return subscriber list of a channel
const getUserChannelSubscribers = asyncHandler(async (req, res) => {
    // Use channelId from params OR if not provided, use the logged-in user's ID
    let { channelId } = req.params;

    if (!channelId?.trim() && req.user?._id) {
        // If no channelId in params, assume fetching subscribers for the logged-in user's channel
        channelId = req.user._id.toString();
    } else if (!isValidObjectId(channelId)) {
        throw new ApiError(400, "Invalid channel ID");
    }

    // TODO: Add pagination (page, limit)
    // const { page = 1, limit = 10 } = req.query;

    const subscribers = await Subscription.aggregate([
        {
            $match: {
                channel: new mongoose.Types.ObjectId(channelId)
            }
        },
        {
            $lookup: {
                from: "users",
                localField: "subscriber",
                foreignField: "_id",
                as: "subscriberInfo",
                pipeline: [
                    {
                        $project: { // Select only necessary fields
                            _id: 1,
                            username: 1,
                            fullName: 1,
                            avatar: 1
                        }
                    }
                ]
            }
        },
        {
            $addFields: {
                subscriberInfo: { $first: "$subscriberInfo" }
            }
        },
        {
            $replaceRoot: { newRoot: "$subscriberInfo" } // Promote subscriber info to root
        }
        // TODO: Add pagination stages ($skip, $limit) here if implementing
    ]);

    if (!subscribers) {
        // Handle case where aggregation might fail unexpectedly
        throw new ApiError(500, "Failed to fetch subscribers");
    }

    return res.status(200).json(
        new ApiResponse(200, subscribers, "Channel subscribers fetched successfully")
    );
});

// Controller to return channel list to which user has subscribed
const getSubscribedChannels = asyncHandler(async (req, res) => {
    // Use subscriberId from params OR if not provided, use the logged-in user's ID
    let { subscriberId } = req.params;

    if (!subscriberId?.trim() && req.user?._id) {
        // If no subscriberId in params, assume fetching channels for the logged-in user
        subscriberId = req.user._id.toString();
    } else if (!isValidObjectId(subscriberId)) {
        throw new ApiError(400, "Invalid subscriber ID");
    }

    // Security check: Ensure the user requesting is the subscriberId or handle permissions appropriately
    // if (req.user?._id.toString() !== subscriberId) {
    //     throw new ApiError(403, "Forbidden: You can only view your own subscriptions");
    // }

    // TODO: Add pagination (page, limit)
    // const { page = 1, limit = 10 } = req.query;

    const subscribedChannels = await Subscription.aggregate([
        {
            $match: {
                subscriber: new mongoose.Types.ObjectId(subscriberId)
            }
        },
        {
            $lookup: {
                from: "users",
                localField: "channel",
                foreignField: "_id",
                as: "channelInfo",
                pipeline: [
                    {
                        $lookup: { // Lookup latest video for thumbnail preview (optional)
                            from: "videos",
                            localField: "_id", // User._id (channel owner)
                            foreignField: "owner",
                            as: "latestVideo",
                            pipeline: [
                                { $sort: { createdAt: -1 } },
                                { $limit: 1 },
                                { $project: { thumbnail: 1 } }
                            ]
                        }
                    },
                    {
                        $addFields: {
                            latestVideoThumbnail: { $first: "$latestVideo.thumbnail" }
                        }
                    },
                    {
                        $project: { // Select necessary channel fields
                            _id: 1,
                            username: 1,
                            fullName: 1,
                            avatar: 1,
                            latestVideoThumbnail: 1 // Include thumbnail if lookup is done
                        }
                    }
                ]
            }
        },
        {
            $addFields: {
                channelInfo: { $first: "$channelInfo" }
            }
        },
        {
            $replaceRoot: { newRoot: "$channelInfo" } // Promote channel info to root
        }
        // TODO: Add pagination stages ($skip, $limit) here if implementing
    ]);

    if (!subscribedChannels) {
        // Handle case where aggregation might fail unexpectedly
        throw new ApiError(500, "Failed to fetch subscribed channels");
    }

    return res.status(200).json(
        new ApiResponse(200, subscribedChannels, "Subscribed channels fetched successfully")
    );
});

export {
    toggleSubscription,
    getUserChannelSubscribers,
    getSubscribedChannels
}