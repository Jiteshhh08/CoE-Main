# File Storage (MinIO)

## Overview

The CoE Portal uses **MinIO**, an S3-compatible object storage server, for storing files and images. Files are served through a secure proxy endpoint instead of direct MinIO URLs.

## Why This Module Exists

The portal needs to handle file uploads:
- **Images**: News photos, event posters, hero slides, grant attachments
- **Documents**: Student resumes, hackathon PPTs, internship files
- **Generated PDFs**: Facility booking tickets, hackathon selection tickets

Using MinIO instead of the server's filesystem means:
- Files survive server restarts
- Storage can scale independently
- Multiple app instances can share the same files
- No database bloat from storing binary data

## Real-World Analogy

Think of MinIO as a **self-storage warehouse**:
- **Warehouse** = MinIO server
- **Storage unit** = Bucket (like `coe-assets`)
- **Box with label** = Object (file with a key/name)
- **Receipt** = The object key stored in the database
- **Delivery person** = The storage proxy (`/api/storage/[...path]`)

## Architecture

```mermaid
graph TB
    subgraph "Upload Sources"
        NEWS["News: imageKey"]
        EVENTS["Events: posterKey"]
        GRANTS["Grants: attachmentKey"]
        HERO["Hero Slides: imageKey"]
        PROFILE["Student Profile: resumeUrl"]
        TICKET["Tickets: pdfObjectKey"]
        HACKATHON["Hackathon: submissionFileKey"]
        INTERN["Internship: documents"]
    end

    subgraph "MinIO Client (src/lib/minio.ts)"
        UPLOAD["uploadFile()"]
        UPLOAD_KEY["uploadFileWithObjectKey()"]
        DELETE["deleteFile()"]
        PROXY["toProxyUrl()"]
    end

    subgraph "Storage"
        BUCKET[("MinIO Bucket<br/>coe-assets")]
    end

    subgraph "Serving"
        PROXY_API["/api/storage/[...path]"]
        BROWSER["Browser"]
    end

    NEWS --> UPLOAD
    EVENTS --> UPLOAD
    HERO --> UPLOAD
    TICKET --> UPLOAD_KEY
    HACKATHON --> UPLOAD
    PROFILE --> UPLOAD

    UPLOAD --> BUCKET
    UPLOAD_KEY --> BUCKET
    DELETE --> BUCKET

    BUCKET --> PROXY_API
    PROXY_API --> BROWSER
```

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/minio.ts` | MinIO client, upload/download/delete functions |
| `src/app/api/storage/[...path]/route.ts` | Proxy endpoint that streams files from MinIO |

## MinIO Client

**File: `src/lib/minio.ts`** (93 lines)

### Configuration

```typescript
const minioClient = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT || 'localhost',  // minio.example.com
  port: parseInt(process.env.MINIO_PORT || '9000'),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
  secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
});

const BUCKET = process.env.MINIO_BUCKET || 'coe-assets';
```

The endpoint can be provided as a hostname (`minio.example.com`) or full URL (`https://minio.example.com`). The client auto-detects which format you're using.

### Key Functions

```typescript
// Upload a file with auto-generated key
export async function uploadFile(
  file: File | Buffer,
  folder: string      // e.g., "news", "hero-slides", "resumes"
): Promise<string>     // Returns object key e.g., "news/1712345678-filename.jpg"

// Upload with a specific object key
export async function uploadFileWithObjectKey(
  buffer: Buffer,
  objectKey: string   // e.g., "tickets/2026/07/BKG-20260727-abc123.pdf"
): Promise<void>

// Delete a file
export async function deleteFile(objectKey: string): Promise<void>

// Get proxy URL
export const toProxyUrl = (objectKey: string): string => {
  return `/api/storage/${encodeURIComponent(objectKey)}`;
};
```

### Upload Flow

```typescript
// 1. Receive file from multipart form
const formData = await req.formData();
const file = formData.get('image') as File;

// 2. Upload to MinIO
const objectKey = await uploadFile(file, 'news');

// 3. Store key in database
await prisma.newsPost.create({
  data: { imageKey: objectKey, title, caption }
});

// 4. Return proxy URL to frontend
return successRes({ imageUrl: toProxyUrl(objectKey) });
```

### Storage Proxy

**File: `src/app/api/storage/[...path]/route.ts`**

Files are NOT served directly from MinIO. Instead, they go through a proxy:

```typescript
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const objectKey = decodeURIComponent(path.join('/'));

  // Stream from MinIO to response
  const stream = await minioClient.getObject(BUCKET, objectKey);
  return new Response(stream as unknown as ReadableStream);
}
```

**Why a proxy?**
- The MinIO server might be on a private network (localhost)
- Browser security prevents fetching from unknown hosts
- The proxy keeps MinIO endpoint hidden from users
- The app domain is the single source for everything

### Folder Organization

```
coe-assets bucket/
├── news/              # News article images
│   └── {timestamp}-{filename}
├── events/            # Event posters
├── grants/            # Grant attachments
├── hero-slides/       # Homepage carousel images
├── resumes/           # Student resumes
├── tickets/           # Generated PDF tickets
│   └── {year}/{month}/{ticketId}.pdf
├── hackathon/         # Hackathon PPT submissions
├── hosting/           # Hosting request files
└── internship/        # Internship workspace files
```

## Common Bugs

### 1. Mixed Content Errors

**Problem**: Page loaded over HTTPS but MinIO URLs are HTTP → browser blocks loading.

**Fix**: Use the proxy endpoint (`/api/storage/...`) which runs on the app's domain. Set `MINIO_USE_PROXY=true`.

### 2. Files Not Found After Upload

**Problem**: The object key is stored in DB but the file returns 404 from proxy.

**Fix**: Check that the object key in the database matches the actual path in MinIO. The `uploadFile()` function returns the exact key.

### 3. Uploaded File Has Wrong Content-Type

**Problem**: Browser displays raw bytes instead of rendering the image.

**Fix**: The proxy needs to pass content-type headers from MinIO. Check that MinIO correctly detects MIME types.

## Exercises

1. **Upload to a new folder**: Add a new folder prefix and upload handler
2. **Add file size validation**: Check file size before uploading
3. **Add image resizing**: Use Sharp to resize images after upload
4. **Add file type validation**: Restrict uploads to specific MIME types

## Summary

MinIO provides S3-compatible object storage for all file uploads. Files are uploaded through the MinIO client, stored in the `coe-assets` bucket, and served through a proxy endpoint (`/api/storage/[...path]`). The proxy keeps the MinIO server address hidden from users and avoids mixed content issues.
