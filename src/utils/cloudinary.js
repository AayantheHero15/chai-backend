import { v2 as cloudinary } from "cloudinary";
import fs from "fs";
import { ApiError } from "./ApiError.js"


// Configuration
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET, // Click 'View API Keys' above to copy your API secret
});


const uploadOnCloudinary = async (localFilePath) => {
    try {
        if (!localFilePath) return null;
        // upload the file on cloudinary
        const response = await cloudinary.uploader.upload(localFilePath, {
            resource_type: "auto",
        });
        // file has been uploaded successfully
        // console.log("file is uploaded on cloudinary", response.url);
        fs.unlinkSync(localFilePath); // remove the locally saved temporary file
        console.log("response: ", response)
        return response;
    } catch (error) {
        fs.unlinkSync(localFilePath); // remove the locally saved temporary file as the upload operation got failed
        return null;
    }
};

const deleteFromCloudinary = async (publicId) => {
    try {
        // Check if publicId exists
        if (!publicId) {
            throw new ApiError(400, "Public ID is required to delete file from cloudinary")
        }
        
        // Delete the file from cloudinary and get response
        const deletionResponse = await cloudinary.uploader.destroy(publicId)

        // Check if deletion was successful
        if (deletionResponse?.result !== "ok") {
            throw new ApiError(400, "Failed to delete file from cloudinary")
        }
        
        return deletionResponse;

    } catch (error) {
        // Handle specific cloudinary errors
        throw new ApiError(
            error?.http_code || 500,
            error?.message || "Something went wrong while deleting file from cloudinary"
        )
    }
};
export { uploadOnCloudinary, deleteFromCloudinary }

