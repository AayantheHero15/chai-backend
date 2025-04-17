import mongoose, {isValidObjectId} from "mongoose"
import {Like} from "../models/like.model.js"
import {ApiError} from "../utils/ApiError.js"
import {ApiResponse} from "../utils/ApiResponse.js"
import {asyncHandler} from "../utils/asyncHandler.js"

const getLikeDetails = async (query) => {
    return await Like.aggregate([
        {
            $match: query
        },
        {
            $lookup: {
                from: "users",
                localField: "likedBy",
                foreignField: "_id",
                as: "userDetails"
            }
        },
        {
            $lookup: {
                from: "videos",
                localField: "video",
                foreignField: "_id",
                as: "videoDetails"
            }
        },
        {
            $lookup: {
                from: "comments",
                localField: "comment",
                foreignField: "_id",
                as: "commentDetails"
            }
        },
        {
            $lookup: {
                from: "tweets",
                localField: "tweet",
                foreignField: "_id",
                as: "tweetDetails"
            }
        },
        {
            $addFields: {
                userDetails: { $first: "$userDetails" },
                videoDetails: { $first: "$videoDetails" },
                commentDetails: { $first: "$commentDetails" },
                tweetDetails: { $first: "$tweetDetails" }
            }
        }
    ]);
};

const toggleVideoLike = asyncHandler(async (req, res) => {
    const {videoId} = req.params
    if (!isValidObjectId(videoId)) {
        throw new ApiError(400, "Invalid video ID")
    }

    const existingLike = await Like.findOne({
        video: videoId,
        likedBy: req.user._id
    })

    if (existingLike) {
        await Like.findByIdAndDelete(existingLike._id)
        return res.status(200).json(
            new ApiResponse(200, {}, "Video unliked successfully")
        )
    }

    const like = await Like.create({
        video: videoId,
        likedBy: req.user._id
    })

    return res.status(201).json(
        new ApiResponse(201, like, "Video liked successfully")
    )
})

const toggleCommentLike = asyncHandler(async (req, res) => {
    const {commentId} = req.params
    if (!isValidObjectId(commentId)) {
        throw new ApiError(400, "Invalid comment ID")
    }

    const existingLike = await Like.findOne({
        comment: commentId,
        likedBy: req.user._id
    })

    if (existingLike) {
        await Like.findByIdAndDelete(existingLike._id)
        return res.status(200).json(
            new ApiResponse(200, {}, "Comment unliked successfully")
        )
    }

    const like = await Like.create({
        comment: commentId,
        likedBy: req.user._id
    })

    return res.status(201).json(
        new ApiResponse(201, like, "Comment liked successfully")
    )
})

const toggleTweetLike = asyncHandler(async (req, res) => {
    const {tweetId} = req.params
    if (!isValidObjectId(tweetId)) {
        throw new ApiError(400, "Invalid tweet ID")
    }

    const existingLike = await Like.findOne({
        tweet: tweetId,
        likedBy: req.user._id
    })

    if (existingLike) {
        await Like.findByIdAndDelete(existingLike._id)
        return res.status(200).json(
            new ApiResponse(200, {}, "Tweet unliked successfully")
        )
    }

    const like = await Like.create({
        tweet: tweetId,
        likedBy: req.user._id
    })

    return res.status(201).json(
        new ApiResponse(201, like, "Tweet liked successfully")
    )
})

const getLikedVideos = asyncHandler(async (req, res) => {
    const likedVideos = await getLikeDetails({
        likedBy: new mongoose.Types.ObjectId(req.user._id),
        video: { $exists: true }
    })

    return res.status(200).json(
        new ApiResponse(200, likedVideos, "Liked videos fetched successfully")
    )
})

export {
    toggleCommentLike,
    toggleTweetLike,
    toggleVideoLike,
    getLikedVideos
}