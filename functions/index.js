const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp(functions.config().firebase);

const mkdirp = require('mkdirp-promise');
// Include a Service Account Key to use a Signed URL
const gcs = require('@google-cloud/storage')({ keyFilename: 'key.json' });



const spawn = require('child-process-promise').spawn;

const path = require('path');
const os = require('os');
const fs = require('fs');

const THUMB_MAX_HEIGHT = 200;
const THUMB_MAX_WIDTH = 200;
// Thumbnail prefix added to file names.
const THUMB_PREFIX = 'thumb_';

exports.generateThumbnailFromImage = functions.storage.object().onChange(event => {
  //RAW folder/Image.png
  const originalFilePath = event.data.name;


  console.log("filePath IS ", originalFilePath);


  //FILE DIR "."
  const originalFileDir = path.dirname(originalFilePath);

  console.log("FILE DIR IS ", originalFileDir);

  //Image.png
  const originalFileName = path.basename(originalFilePath);

  console.log("FILE NAME IS ", originalFileName);


  // /tmp/folder/Image.png
  const tempFilePath = path.join(os.tmpdir(), originalFilePath);
  console.log("tempLocalFile IS ", tempFilePath);

  // /tmp/folder
  const tempFileDir = path.dirname(tempFilePath);
  console.log("tempLocalDir IS ", tempFileDir);

  // thumb_image.png
  const thumbFilePath = path.normalize(path.join(originalFileDir, `${THUMB_PREFIX}${originalFileName}`));
  console.log("thumbFilePath IS ", thumbFilePath);


  //tmp/thumb_image.png  
  const tempThumbFilePath = path.join(os.tmpdir(), thumbFilePath);
  console.log("tempLocalThumbFile IS ", tempThumbFilePath);


  if (!event.data.contentType.startsWith('image/')) {
    console.log('This is not an image.');
    return null;
  }


  // Exit if the image is already a thumbnail.
  if (originalFileName.startsWith(THUMB_PREFIX)) {
    console.log('Already a Thumbnail.');
    return null ;
  }

  // Exit if this is a move or deletion event.
  if (event.data.resourceState === 'not_exists') {
    console.log('This is a deletion event.');
    return null;
  }

  // Cloud Storage files.
  const bucket = gcs.bucket(event.data.bucket);
  const file = bucket.file(originalFilePath);
  
  const thumbFile = bucket.file(thumbFilePath);
  console.log("BUCKET THUMB FILE ",thumbFile);
  


  // Create the temp directory where the storage file will be downloaded.
  return mkdirp(tempFileDir).then(() => {
    // Download file from bucket.
    return file.download({ destination: tempFilePath });
  }).then(() => {


    console.log('The file has been downloaded to', tempFilePath);
    // Generate a thumbnail using ImageMagick.

    return spawn('convert', [tempFilePath, '-thumbnail', `${THUMB_MAX_WIDTH}x${THUMB_MAX_HEIGHT}>`, tempThumbFilePath]);


  }).then(() => {

    return spawn('convert', [tempThumbFilePath, '-channel', 'RGBA', '-blur', '0x2', tempThumbFilePath]);

    console.log('Thumbnail created at', tempThumbFilePath);

  }).then(() => {



    // Uploading the Thumbnail.
    return bucket.upload(tempThumbFilePath, { destination: thumbFilePath });
    

  }).then(() => {
    // Once the image has been uploaded delete the local files to free up disk space.
    console.log('Thumbnail uploaded to Storage at', thumbFilePath);
    
    fs.unlinkSync(tempFilePath);
    fs.unlinkSync(tempThumbFilePath);
    const config = {
      action: 'read',
      expires: '03-01-2500',
    };
    return Promise.all([
      thumbFile.getSignedUrl(config),
      file.getSignedUrl(config),
    ]);
  }).then((results) => {
    console.log('Got Signed URLs.');
    const thumbResult = results[0];
    const originalResult = results[1];
    const thumbFileUrl = thumbResult[0];
    const fileUrl = originalResult[0];
    // Add the URLs to the Database
    return admin.database().ref('images').push({ path: fileUrl, thumbnail: thumbFileUrl });
  }).then(() => console.log('Thumbnail URLs saved to database.'));
});
