import mongoose, { isValidObjectId } from "mongoose"
import { Comment } from "../models/comment.model.js"
import { ApiError } from "../utils/ApiError.js"
import { ApiResponse } from "../utils/ApiResponse.js"
import { asyncHandler } from "../utils/asyncHandler.js"

// Helper function (optional, consider if needed elsewhere)
const getCommentWithDetails = async (commentId) => {
    if (!isValidObjectId(commentId)) {
        throw new ApiError(400, "Invalid comment ID");
    }
    return await Comment.aggregate([
        {
            $match: {
                _id: new mongoose.Types.ObjectId(commentId)
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
                foreignField: "comment",
                as: "likes"
            }
        },
        {
            $addFields: {
                ownerDetails: { $first: "$ownerDetails" },
                likesCount: { $size: "$likes" },
                isLiked: {
                    // Add logic to check if the current user liked this comment if needed
                    $cond: {
                        if: { $in: [req.user?._id, "$likes.likedBy"] }, // Assuming req.user is available
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
                isLiked: 1 // Include if needed
            }
        }
    ]);
};

const getVideoComments = asyncHandler(async (req, res) => {
    const { videoId } = req.params;
    const { page = 1, limit = 10 } = req.query;

    if (!isValidObjectId(videoId)) {
        throw new ApiError(400, "Invalid video ID");
    }

    // Convert page and limit to numbers, ensure they are positive integers
    const pageNumber = parseInt(page, 10);
    const limitNumber = parseInt(limit, 10);

    if (isNaN(pageNumber) || pageNumber < 1 || isNaN(limitNumber) || limitNumber < 1) {
        throw new ApiError(400, "Invalid page or limit parameters");
    }

    const pipeline = [
        {
            $match: {
                video: new mongoose.Types.ObjectId(videoId)
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
                foreignField: "comment",
                as: "likes"
            }
        },
        {
            $addFields: {
                ownerDetails: { $first: "$ownerDetails" },
                likesCount: { $size: "$likes" },
                isLiked: {
                    $cond: {
                        if: { $in: [req.user?._id, "$likes.likedBy"] },
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
            $project: {
                content: 1,
                createdAt: 1,
                ownerDetails: 1,
                likesCount: 1,
                isLiked: 1
            }
        }
    ];

    // Add pagination stages
    pipeline.push(
        {
            $skip: (pageNumber - 1) * limitNumber
        },
        {
            $limit: limitNumber
        }
    );

    const comments = await Comment.aggregate(pipeline);

    // Optionally, get total count for pagination metadata
    const totalComments = await Comment.countDocuments({ video: videoId });

    return res.status(200).json(
        new ApiResponse(
            200,
            { comments, totalComments, page: pageNumber, limit: limitNumber, totalPages: Math.ceil(totalComments / limitNumber) },
            "Comments fetched successfully"
        )
    );
});

const addComment = asyncHandler(async (req, res) => {
    const { videoId } = req.params;
    const { content } = req.body;

    if (!isValidObjectId(videoId)) {
        throw new ApiError(400, "Invalid video ID");
    }

    if (!content?.trim()) {
        throw new ApiError(400, "Content is required");
    }

    if (!req.user?._id) {
        throw new ApiError(401, "Unauthorized request");
    }

    const comment = await Comment.create({
        content: content.trim(),
        video: videoId,
        owner: req.user._id
    });

    if (!comment) {
        throw new ApiError(500, "Failed to add comment");
    }

    // Fetch details after creation to include owner info etc.
    // Consider optimizing this if getCommentWithDetails is complex or slow
    const commentDetailsPipeline = [
        { $match: { _id: comment._id } },
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
                ownerDetails: { $first: "$ownerDetails" },
                likesCount: 0, // New comment has 0 likes
                isLiked: false // New comment is not liked by creator
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

    const createdCommentDetails = await Comment.aggregate(commentDetailsPipeline);

    return res.status(201).json(
        new ApiResponse(201, createdCommentDetails[0], "Comment added successfully")
    );
});

const updateComment = asyncHandler(async (req, res) => {
    const { commentId } = req.params;
    const { content } = req.body;

    if (!isValidObjectId(commentId)) {
        throw new ApiError(400, "Invalid comment ID");
    }

    if (!content?.trim()) {
        throw new ApiError(400, "Content is required");
    }

    if (!req.user?._id) {
        throw new ApiError(401, "Unauthorized request");
    }

    const comment = await Comment.findOneAndUpdate(
        {
            _id: new mongoose.Types.ObjectId(commentId),
            owner: req.user._id // Ensure only the owner can update
        },
        {
            $set: {
                content: content.trim()
            }
        },
        { new: true } // Return the updated document
    );

    if (!comment) {
        // Could be not found OR user is not the owner
        throw new ApiError(404, "Comment not found or you don't have permission to update it");
    }

    return res.status(200).json(
        new ApiResponse(200, comment, "Comment updated successfully")
    );
});

const deleteComment = asyncHandler(async (req, res) => {
    const { commentId } = req.params;

    if (!isValidObjectId(commentId)) {
        throw new ApiError(400, "Invalid comment ID");
    }

    if (!req.user?._id) {
        throw new ApiError(401, "Unauthorized request");
    }

    const comment = await Comment.findOneAndDelete({
        _id: new mongoose.Types.ObjectId(commentId),
        owner: req.user._id // Ensure only the owner can delete
    });

    if (!comment) {
        // Could be not found OR user is not the owner
        throw new ApiError(404, "Comment not found or you don't have permission to delete it");
    }

    // TODO: Consider deleting associated likes for this comment
    // await Like.deleteMany({ comment: commentId });

    return res.status(200).json(
        new ApiResponse(200, { deletedCommentId: commentId }, "Comment deleted successfully")
    );
});

export {
    getVideoComments,
    addComment,
    updateComment,
    deleteComment
}
