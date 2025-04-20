import mongoose, { isValidObjectId } from "mongoose"
import { Video } from "../models/video.model.js"
import { ApiError } from "../utils/ApiError.js"
import { ApiResponse } from "../utils/ApiResponse.js"
import { asyncHandler } from "../utils/asyncHandler.js"
import { uploadOnCloudinary } from "../utils/cloudinary.js"


const getAllVideos = asyncHandler(async (req, res) => {
    const { page = 1, limit = 10, query, sortBy = "createdAt", sortType = "desc", userId } = req.query;

    // Convert page and limit to numbers, ensure they are positive integers
    const pageNumber = parseInt(page, 10);
    const limitNumber = parseInt(limit, 10);

    if (isNaN(pageNumber) || pageNumber < 1 || isNaN(limitNumber) || limitNumber < 1) {
        throw new ApiError(400, "Invalid page or limit parameters");
    }

    const pipeline = [];
    const matchStage = {};

    // Match by userId if provided
    if (userId) {
        if (!isValidObjectId(userId)) {
            throw new ApiError(400, "Invalid userId");
        }
        matchStage.owner = new mongoose.Types.ObjectId(userId);
        // Allow owner to see their unpublished videos
        if (!(req.user?._id && req.user._id.toString() === userId)) {
            matchStage.isPublished = true;
        }
    } else {
        // Default: only show published videos if no specific user is requested
        matchStage.isPublished = true;
    }

    // Match by search query if provided
    if (query) {
        matchStage.$or = [
            { title: { $regex: query, $options: "i" } },
            { description: { $regex: query, $options: "i" } }
        ];
    }

    // Add the combined match stage
    if (Object.keys(matchStage).length > 0) {
        pipeline.push({ $match: matchStage });
    }

    // Add lookup stages
    pipeline.push(
        {
            $lookup: {
                from: "users",
                localField: "owner",
                foreignField: "_id",
                as: "ownerDetails"
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
                ownerDetails: { $first: "$ownerDetails" },
                likesCount: { $size: "$likes" }
            }
        }
    )

    // Define valid sort fields to prevent arbitrary field sorting
    const validSortFields = ["createdAt", "views", "duration"];
    const sortField = validSortFields.includes(sortBy) ? sortBy : "createdAt";
    const sortOrder = sortType === "desc" ? -1 : 1;

    // Add sorting
    pipeline.push({
        $sort: {
            [sortField]: sortOrder
        }
    });

    // Add pagination using calculated numbers
    pipeline.push(
        {
            $skip: (pageNumber - 1) * limitNumber
        },
        {
            $limit: limitNumber
        }
    );

    const videos = await Video.aggregate(pipeline)

    return res.status(200).json(
        new ApiResponse(200, videos, "Videos fetched successfully")
    )
})

const publishAVideo = asyncHandler(async (req, res) => {
    const { title, description } = req.body

    if (!title?.trim() || !description?.trim()) {
        throw new ApiError(400, "Title and description are required")
    }

    // Get video and thumbnail files
    const videoLocalPath = req.files?.videoFile?.[0]?.path
    const thumbnailLocalPath = req.files?.thumbnail?.[0]?.path

    if (!videoLocalPath) {
        throw new ApiError(400, "Video file is required")
    }

    // Upload to cloudinary
    const videoFile = await uploadOnCloudinary(videoLocalPath)
    const thumbnail = await uploadOnCloudinary(thumbnailLocalPath)

    if (!videoFile) {
        throw new ApiError(500, "Failed to upload video to cloudinary")
    }

    // Create video
    const video = await Video.create({
        title,
        description,
        videoFile: videoFile.url,
        thumbnail: thumbnail?.url || "",
        duration: videoFile.duration,
        owner: req.user?._id
    })

    return res.status(201).json(
        new ApiResponse(201, video, "Video published successfully")
    )
})

const getVideoById = asyncHandler(async (req, res) => {
    const { videoId } = req.params

    if (!isValidObjectId(videoId)) {
        throw new ApiError(400, "Invalid video ID")
    }

    // Find the video by ID
    const videoPipeline = [
        {
            $match: {
                _id: new mongoose.Types.ObjectId(videoId)
            }
        },
        // Add stages to check publish status and ownership
        {
            $addFields: {
                isOwner: {
                    $cond: {
                        if: { $eq: ["$owner", new mongoose.Types.ObjectId(req.user?._id)] },
                        then: true,
                        else: false
                    }
                }
            }
        },
        {
            $match: {
                $or: [
                    { isPublished: true },
                    { isOwner: true } // Owner can see unpublished videos
                ]
            }
        },
        {
            $lookup: {
                from: "users",
                localField: "owner",
                foreignField: "_id",
                as: "ownerDetails"
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
                ownerDetails: { $first: "$ownerDetails" },
                likesCount: { $size: "$likes" },
                isOwner: {
                    $cond: {
                        if: { $eq: ["$owner", new mongoose.Types.ObjectId(req.user?._id)] },
                        then: true,
                        else: false
                    }
                }
            }
        }
    ]

    const video = await Video.aggregate(videoPipeline);

    if (!video?.length) {
        throw new ApiError(404, "Video not found or access denied")
    }

    return res.status(200).json(
        new ApiResponse(200, video[0], "Video fetched successfully")
    )
})

const updateVideo = asyncHandler(async (req, res) => {
    const { videoId } = req.params
    const { title, description } = req.body

    if (!isValidObjectId(videoId)) {
        throw new ApiError(400, "Invalid video ID")
    }

    if (!title?.trim() && !description?.trim() && !req.files?.thumbnail) {
        throw new ApiError(400, "At least one field is required to update")
    }

    const updateFields = {}

    if (title?.trim()) updateFields.title = title
    if (description?.trim()) updateFields.description = description

    // Update thumbnail if provided
    if (req.files?.thumbnail) {
        const thumbnailLocalPath = req.files.thumbnail[0].path
        const thumbnail = await uploadOnCloudinary(thumbnailLocalPath)

        if (thumbnail?.url) {
            updateFields.thumbnail = thumbnail.url
        }
    }

    if (!req.user?._id) {
        throw new ApiError(401, "Unauthorized request");
    }

    const video = await Video.findOneAndUpdate(
        {
            _id: videoId,
            owner: req.user._id // Use req.user._id directly after check
        },
        {
            $set: updateFields
        },
        { new: true }
    )

    if (!video) {
        throw new ApiError(404, "Video not found or unauthorized")
    }

    return res.status(200).json(
        new ApiResponse(200, video, "Video updated successfully")
    )
})

const deleteVideo = asyncHandler(async (req, res) => {
    const { videoId } = req.params

    if (!isValidObjectId(videoId)) {
        throw new ApiError(400, "Invalid video ID")
    }

    if (!req.user?._id) {
        throw new ApiError(401, "Unauthorized request");
    }

    const video = await Video.findOneAndDelete({
        _id: videoId,
        owner: req.user._id // Use req.user._id directly after check
    })

    if (!video) {
        throw new ApiError(404, "Video not found or unauthorized")
    }

    return res.status(200).json(
        new ApiResponse(200, {}, "Video deleted successfully")
    )
})

const togglePublishStatus = asyncHandler(async (req, res) => {
    const { videoId } = req.params

    if (!isValidObjectId(videoId)) {
        throw new ApiError(400, "Invalid video ID")
    }

    if (!req.user?._id) {
        throw new ApiError(401, "Unauthorized request");
    }

    const video = await Video.findOne({
        _id: videoId,
        owner: req.user._id // Use req.user._id directly after check
    })

    if (!video) {
        throw new ApiError(404, "Video not found or unauthorized")
    }

    video.isPublished = !video.isPublished
    await video.save()

    return res.status(200).json(
        new ApiResponse(200, video, `Video ${video.isPublished ? 'published' : 'unpublished'} successfully`)
    )
})

export {
    getAllVideos,
    publishAVideo,
    getVideoById,
    updateVideo,
    deleteVideo,
    togglePublishStatus
}
