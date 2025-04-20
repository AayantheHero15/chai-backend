import mongoose, { isValidObjectId } from "mongoose"
import { Playlist } from "../models/playlist.model.js"
import { Video } from "../models/video.model.js" // Import Video model for validation
import { ApiError } from "../utils/ApiError.js"
import { ApiResponse } from "../utils/ApiResponse.js"
import { asyncHandler } from "../utils/asyncHandler.js"

const createPlaylist = asyncHandler(async (req, res) => {
    const { name, description } = req.body;

    if (!name?.trim()) {
        throw new ApiError(400, "Playlist name is required");
    }

    if (!req.user?._id) {
        throw new ApiError(401, "Unauthorized request");
    }

    const playlist = await Playlist.create({
        name: name.trim(),
        description: description?.trim() || "", // Allow empty description
        owner: req.user._id
    });

    if (!playlist) {
        throw new ApiError(500, "Failed to create playlist");
    }

    return res.status(201).json(
        new ApiResponse(201, playlist, "Playlist created successfully")
    );
});

const getUserPlaylists = asyncHandler(async (req, res) => {
    const { userId } = req.params;

    if (!isValidObjectId(userId)) {
        throw new ApiError(400, "Invalid user ID");
    }

    // TODO: Add pagination if needed
    const playlists = await Playlist.aggregate([
        {
            $match: {
                owner: new mongoose.Types.ObjectId(userId)
            }
        },
        {
            $lookup: {
                from: "videos",
                localField: "videos",
                foreignField: "_id",
                as: "videosList",
                pipeline: [
                    {
                        $project: { // Select only necessary fields from videos
                            _id: 1,
                            thumbnail: 1,
                            title: 1,
                            duration: 1
                        }
                    }
                ]
            }
        },
        {
            $addFields: {
                totalVideos: { $size: "$videosList" },
                totalViews: { $sum: "$videosList.views" } // Note: This requires videos to have views populated, might need adjustment
            }
        },
        {
            $project: { // Select final fields for the playlist
                _id: 1,
                name: 1,
                description: 1,
                createdAt: 1,
                updatedAt: 1,
                totalVideos: 1,
                // totalViews: 1, // Uncomment if views calculation is reliable
                videosList: { $slice: ["$videosList", 3] } // Get first 3 videos for preview
            }
        }
    ]);

    return res.status(200).json(
        new ApiResponse(200, playlists, "User playlists fetched successfully")
    );
});

const getPlaylistById = asyncHandler(async (req, res) => {
    const { playlistId } = req.params;

    if (!isValidObjectId(playlistId)) {
        throw new ApiError(400, "Invalid playlist ID");
    }

    const playlistPipeline = [
        {
            $match: {
                _id: new mongoose.Types.ObjectId(playlistId)
            }
        },
        {
            $lookup: {
                from: "videos",
                localField: "videos",
                foreignField: "_id",
                as: "videos",
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
                            description: 1,
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
            $lookup: {
                from: "users",
                localField: "owner",
                foreignField: "_id",
                as: "ownerDetails",
                pipeline: [
                    {
                        $project: {
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
                ownerDetails: { $first: "$ownerDetails" },
                totalVideos: { $size: "$videos" },
                totalViews: { $sum: "$videos.views" } // Sum views of all videos in the playlist
            }
        },
        {
            $project: { // Final projection for the playlist response
                _id: 1,
                name: 1,
                description: 1,
                createdAt: 1,
                updatedAt: 1,
                ownerDetails: 1,
                videos: 1,
                totalVideos: 1,
                totalViews: 1
            }
        }
    ];

    const playlist = await Playlist.aggregate(playlistPipeline);

    if (!playlist || playlist.length === 0) {
        throw new ApiError(404, "Playlist not found");
    }

    return res.status(200).json(
        new ApiResponse(200, playlist[0], "Playlist fetched successfully")
    );
});

const addVideoToPlaylist = asyncHandler(async (req, res) => {
    const { playlistId, videoId } = req.params;

    if (!isValidObjectId(playlistId) || !isValidObjectId(videoId)) {
        throw new ApiError(400, "Invalid playlist or video ID");
    }

    if (!req.user?._id) {
        throw new ApiError(401, "Unauthorized request");
    }

    // Check if video exists
    const video = await Video.findById(videoId);
    if (!video) {
        throw new ApiError(404, "Video not found");
    }

    // Find the playlist and verify ownership
    const playlist = await Playlist.findOne({
        _id: playlistId,
        owner: req.user._id
    });

    if (!playlist) {
        throw new ApiError(404, "Playlist not found or you don't have permission");
    }

    // Check if video is already in the playlist
    if (playlist.videos.includes(videoId)) {
        return res.status(200).json(
            new ApiResponse(200, playlist, "Video already exists in the playlist")
        );
        // Or throw new ApiError(400, "Video already exists in the playlist");
    }

    // Add video using $addToSet
    const updatedPlaylist = await Playlist.findByIdAndUpdate(
        playlistId, // Already verified ownership
        {
            $addToSet: { videos: videoId } // Use $addToSet to avoid duplicates
        },
        { new: true } // Return the updated document
    );

    if (!updatedPlaylist) {
        // This shouldn't happen if the findOne check passed, but good practice
        throw new ApiError(500, "Failed to add video to playlist");
    }

    return res.status(200).json(
        new ApiResponse(200, updatedPlaylist, "Video added to playlist successfully")
    );
});

const removeVideoFromPlaylist = asyncHandler(async (req, res) => {
    const { playlistId, videoId } = req.params;

    if (!isValidObjectId(playlistId) || !isValidObjectId(videoId)) {
        throw new ApiError(400, "Invalid playlist or video ID");
    }

    if (!req.user?._id) {
        throw new ApiError(401, "Unauthorized request");
    }

    // Find the playlist and verify ownership
    const playlist = await Playlist.findOne({
        _id: playlistId,
        owner: req.user._id
    });

    if (!playlist) {
        throw new ApiError(404, "Playlist not found or you don't have permission");
    }

    // Check if video exists in the playlist before attempting removal
    if (!playlist.videos.includes(videoId)) {
        throw new ApiError(404, "Video not found in this playlist");
    }

    // Remove video using $pull
    const updatedPlaylist = await Playlist.findByIdAndUpdate(
        playlistId, // Already verified ownership
        {
            $pull: { videos: videoId }
        },
        { new: true } // Return the updated document
    );

    if (!updatedPlaylist) {
        // This shouldn't happen if the findOne check passed, but good practice
        throw new ApiError(500, "Failed to remove video from playlist");
    }

    return res.status(200).json(
        new ApiResponse(200, updatedPlaylist, "Video removed from playlist successfully")
    );
});

const deletePlaylist = asyncHandler(async (req, res) => {
    const { playlistId } = req.params;

    if (!isValidObjectId(playlistId)) {
        throw new ApiError(400, "Invalid playlist ID");
    }

    if (!req.user?._id) {
        throw new ApiError(401, "Unauthorized request");
    }

    // Find and delete the playlist, ensuring ownership
    const deletedPlaylist = await Playlist.findOneAndDelete({
        _id: playlistId,
        owner: req.user._id
    });

    if (!deletedPlaylist) {
        throw new ApiError(404, "Playlist not found or you don't have permission to delete it");
    }

    // Note: Videos within the playlist are not deleted, only the playlist itself.

    return res.status(200).json(
        new ApiResponse(200, { deletedPlaylistId: playlistId }, "Playlist deleted successfully")
    );
});

const updatePlaylist = asyncHandler(async (req, res) => {
    const { playlistId } = req.params;
    const { name, description } = req.body;

    if (!isValidObjectId(playlistId)) {
        throw new ApiError(400, "Invalid playlist ID");
    }

    if (!name?.trim() && !description?.trim()) {
        throw new ApiError(400, "At least name or description is required to update");
    }

    if (!req.user?._id) {
        throw new ApiError(401, "Unauthorized request");
    }

    // Prepare update object, only include fields that are provided
    const updateData = {};
    if (name?.trim()) {
        updateData.name = name.trim();
    }
    if (description?.trim()) {
        updateData.description = description.trim();
    } else if (description === "") { // Allow setting description to empty
        updateData.description = "";
    }

    // Find and update the playlist, ensuring ownership
    const updatedPlaylist = await Playlist.findOneAndUpdate(
        {
            _id: playlistId,
            owner: req.user._id
        },
        {
            $set: updateData
        },
        { new: true } // Return the updated document
    );

    if (!updatedPlaylist) {
        throw new ApiError(404, "Playlist not found or you don't have permission to update it");
    }

    return res.status(200).json(
        new ApiResponse(200, updatedPlaylist, "Playlist updated successfully")
    );
});

export {
    createPlaylist,
    getUserPlaylists,
    getPlaylistById,
    addVideoToPlaylist,
    removeVideoFromPlaylist,
    deletePlaylist,
    updatePlaylist
};
