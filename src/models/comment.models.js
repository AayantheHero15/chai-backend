import mongoose from "mongoose";
import mongooseAggregatePaginate from "mongoose-aggregate-paginate-v2";

const commentSchema = new mongoose.Schema({
    owner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
    },

    playlist: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Playlist",
    },

    content: {
        type: String,
        required: true,
    },

    likes: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
    }],

    video: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Video",
    },

    createdAt: {
        type: Date,
        default: Date.now,
    },

    updatedAt: {
        type: Date,
        default: Date.now,
    },  
}, { timestamps: true });

// Pipeline to get comment with all details
commentSchema.static('getCommentWithDetails', function(commentId) {
    return this.aggregate([
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
                as: "ownerDetails"
            }
        },
        {
            $lookup: {
                from: "playlists",
                localField: "playlist",
                foreignField: "_id",
                as: "playlistDetails"
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
                from: "likes",
                localField: "_id",
                foreignField: "comment",
                as: "likeDetails"
            }
        },
        {
            $addFields: {
                ownerDetails: { $first: "$ownerDetails" },
                playlistDetails: { $first: "$playlistDetails" },
                videoDetails: { $first: "$videoDetails" },
                likeCount: { $size: "$likeDetails" }
            }
        }
    ]);
});

commentSchema.plugin(mongooseAggregatePaginate);

export const Comment = mongoose.model("Comment", commentSchema);


