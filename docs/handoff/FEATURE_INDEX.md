# Feature Discovery Index

A complete index of every feature in the CoE Portal and Project Dashboard.

---

## CoE Portal (Main Application)

| # | Module | Description | Pages | APIs | DB Models | Difficulty | Order |
|---|--------|-------------|-------|------|-----------|------------|-------|
| 1 | **Authentication** | Login, register, OTP verify, JWT management, Google Sign-In, shared SSO | `/login`, `/forgot-password`, `/register` | `/api/auth/*` (12 endpoints) | `User`, `Otp`, `ImpersonationSession` | **Beginner** | 1 |
| 2 | **User Profile** | View and update personal profile, UID-based identity | `/profile` | `/api/profile`, `/api/profile/check-completion` | `User`, `StudentProfile`, `FacultyProfile` | **Beginner** | 2 |
| 3 | **Content Management** | News, events, grants, announcements CRUD with image upload | `/` (homepage), `/faculty` | `/api/news/*`, `/api/events/*`, `/api/grants/*`, `/api/announcements/*`, `/api/hero-slides/*` | `NewsPost`, `Event`, `Grant`, `Announcement`, `HeroSlide` | **Beginner** | 3 |
| 4 | **Facility Booking** | Student creates bookings, admin moderates, tickets generated, email reminders | `/facility-booking` | `/api/bookings/*`, `/api/admin/bookings/*`, `/api/tickets/*` | `Booking`, `Ticket`, `TicketAttendance` | **Intermediate** | 4 |
| 5 | **Innovation Platform** | Open problems and hackathons, student profiles, applications, scoring, leaderboard | `/innovation/*`, `/innovation/faculty*` | `/api/innovation/*` (20+ endpoints) | `Problem`, `Claim`, `ClaimMember`, `HackathonEvent`, `StudentProfile`, `Application`, `ApplicationAnswer`, `ProblemQuestion`, `HackathonInterest` | **Advanced** | 5 |
| 6 | **Admin Portal** | User management, stats, faculty approval, email broadcast, impersonation, booking moderation | `/admin` | `/api/admin/*` (15+ endpoints) | User, Booking, EmailJob + all others | **Intermediate** | 6 |
| 7 | **Faculty Portal** | Content publishing, application review, hackathon judging, student management | `/faculty` | `/api/faculty/*` | User, NewsPost, Event, Grant, Application, Claim, Problem | **Intermediate** | 7 |
| 8 | **Internship System** | Industry and faculty internships, participant management, workspace tools | `/industry-internship`, `/faculty-internship`, `/student-internship` | `/api/internships/*` | `Problem` (INTERNSHIP type), `InternshipTask`, `InternshipMessage`, `InternshipMeeting`, `InternshipDocument`, `Notification` | **Advanced** | 8 |
| 9 | **Project Hosting** | Student requests for project hosting, admin review and deployment | `/project-hosting` | `/api/project-hosting/*`, `/api/admin/hosting-requests/*` | `HostingRequest`, `HostingRequestStatusHistory` | **Intermediate** | 9 |
| 10 | **Email System** | Queue-based email delivery, templates, cron worker, retry logic | Admin email panel | `/api/cron/email-queue`, `/api/admin/emails/*` | `EmailJob` | **Intermediate** | 10 |
| 11 | **File Storage** | MinIO-based object storage, upload, proxy serving | Internal | `/api/storage/[...path]` | Object keys stored on models | **Beginner** | 11 |
| 12 | **Cron Jobs** | Scheduled background tasks for reminders and notifications | Internal | `/api/cron/*` (4 endpoints) | Booking, HackathonEvent, EmailJob | **Intermediate** | 12 |
| 13 | **Impersonation** | Admin can temporarily act as another user for debugging | Admin panel | `/api/admin/impersonate/*` | `ImpersonationSession` | **Advanced** | 13 |
| 14 | **Activity Logging** | Structured JSON logging of important events | Internal | `logActivity()` utility | Console logs | **Beginner** | 14 |
| 15 | **Analytics** | Google Analytics 4 event tracking for key user actions | Internal | Client-side GA4 | None | **Beginner** | 15 |
| 16 | **Dashboard Sync** | Fire-and-forget user sync to Project Dashboard | Internal | `syncDashboardUser()` | None (HTTP call) | **Beginner** | 16 |

## Project Dashboard (Supporting Application)

| # | Module | Description | Pages | APIs | DB Models | Difficulty | Order |
|---|--------|-------------|-------|------|-----------|------------|-------|
| 17 | **Shared Authentication** | JWT cookie verification, middleware, user auto-provisioning | All pages | Middleware | Dashboard `User` | **Intermediate** | 1 |
| 18 | **Project Management** | Academic project tracking, tasks, milestones, reviews | `/(dashboard)/*` | Server actions | `Project`, `ProjectMember`, `Task`, `Milestone`, `Review` | **Intermediate** | 2 |
| 19 | **Showcase System** | Versioned project submissions, admin review, public publishing | `/showcase/*` | `/api/showcase/*`, `/api/cron/*` | `ShowcaseProject`, `ProjectVersion`, `ReviewFeedback`, `ProjectAsset`, `ShowcaseTeamMember` | **Advanced** | 3 |
| 20 | **CSV Assignment** | Bulk student assignment via CSV import, email outbox | Admin pages | `/api/cron/process-emails` | `EmailQueue`, `PendingProjectAssignment` | **Intermediate** | 4 |
| 21 | **Bounce Detection** | Automatic detection of failed invitation emails via Gmail API | Internal | `/api/cron/detect-bounces` | `PendingProjectAssignment` (bounce fields) | **Advanced** | 5 |
| 22 | **Admin Project Control** | Central admin management of all projects, mentors, members | `/admin/projects` | Server actions | `Project`, `ProjectMember` | **Intermediate** | 6 |
| 23 | **Email Outbox** | Queue-based email sending with retry, admin monitoring | `/admin/email-logs` | `/api/cron/process-emails` | `EmailQueue` | **Intermediate** | 7 |
| 24 | **Public Explorers** | Public project browsing pages | `/majorprojects`, `/rblprojects-te` | None (static/server) | Project | **Beginner** | 8 |

## Complete API Endpoint Index

### Auth Endpoints (CoE Portal — 12 endpoints)

| Method | Endpoint | Purpose | Auth |
|--------|----------|---------|------|
| POST | `/api/auth/login` | Login with email/UID + password | None |
| POST | `/api/auth/logout` | Logout (clear cookies) | Cookie |
| POST | `/api/auth/refresh` | Refresh access token | Refresh cookie |
| POST | `/api/auth/register/student` | Register new student | None |
| POST | `/api/auth/register/faculty` | Register new faculty | None |
| POST | `/api/auth/verify-otp` | Verify OTP + auto-login | None |
| POST | `/api/auth/resend-otp` | Resend OTP (rate limited) | None |
| POST | `/api/auth/forgot-password` | Request password reset OTP | None |
| POST | `/api/auth/reset-password` | Reset password with OTP | None |
| POST | `/api/auth/google` | Google OAuth entry | None |
| POST | `/api/auth/register/google` | Complete Google registration | `pending_reg` cookie |
| POST | `/api/auth/google/link` | Link Google to existing account | None |

### Booking Endpoints (5 endpoints)

| Method | Endpoint | Purpose | Auth |
|--------|----------|---------|------|
| POST | `/api/bookings` | Create a booking | Student |
| GET | `/api/bookings` | Get guidance info | Public |
| GET | `/api/bookings/my` | Get user's bookings | Student |
| DELETE | `/api/bookings/[id]` | Cancel own booking | Student |
| GET | `/api/tickets/my` | Get user's tickets | Student |
| GET | `/api/tickets/[ticketId]` | Get ticket details | Student |
| GET | `/api/tickets/[ticketId]/download` | Download ticket PDF | Student |
| POST | `/api/tickets/[ticketId]/cancel` | Cancel ticket | Student |
| POST | `/api/tickets/verify` | Verify a ticket | Admin |

### Admin Endpoints (15+ endpoints)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/admin/stats` | Dashboard statistics |
| GET | `/api/admin/users` | List all users |
| GET | `/api/admin/users/[id]` | Get user details |
| GET | `/api/admin/users/export` | Export users as CSV |
| GET | `/api/admin/bookings` | List all bookings |
| PATCH | `/api/admin/bookings/[id]/confirm` | Confirm booking |
| PATCH | `/api/admin/bookings/[id]/reject` | Reject booking |
| PATCH | `/api/admin/faculty/[id]/approve` | Approve faculty |
| PATCH | `/api/admin/faculty/[id]/reject` | Reject faculty |
| POST | `/api/admin/impersonate/start` | Start impersonation |
| POST | `/api/admin/impersonate/stop` | Stop impersonation |
| POST | `/api/admin/emails/send` | Send broadcast email |
| POST | `/api/admin/emails/retry` | Retry failed emails |

### Innovation Endpoints (20+ endpoints)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/innovation/problems` | List problems |
| POST | `/api/innovation/problems` | Create problem |
| PATCH | `/api/innovation/problems/[id]` | Update problem |
| DELETE | `/api/innovation/problems/[id]` | Delete problem |
| GET | `/api/innovation/problems/[id]/questions` | Get problem questions |
| POST | `/api/innovation/applications` | Submit application |
| GET | `/api/innovation/applications/my` | Get my applications |
| GET | `/api/innovation/events` | List hackathon events |
| POST | `/api/innovation/events` | Create event |
| PATCH | `/api/innovation/events/[id]` | Update event |
| POST | `/api/innovation/events/[id]/register` | Register team |
| GET | `/api/innovation/events/[id]/leaderboard` | Get leaderboard |
| POST | `/api/innovation/claims` | Create claim |
| GET | `/api/innovation/claims/my` | Get my claims |
| PATCH | `/api/innovation/claims/[id]/submit` | Submit claim |
| PATCH | `/api/innovation/faculty/claims/sync` | Sync claim decisions |
| GET | `/api/innovation/faculty/applications` | List applications |
| PATCH | `/api/innovation/faculty/applications/[id]/review` | Review application |

### Cron Endpoints (4 endpoints)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/cron/reminder` | Send booking reminders |
| GET | `/api/cron/innovation-reminder` | Innovation event reminders |
| GET | `/api/cron/email-queue` | Process email queue |
| GET | `/api/cron/problem-statement-notification` | Problem notification |

### Content Endpoints (15+ endpoints)

| Method | Group | Purpose |
|--------|-------|---------|
| GET/POST | `/api/news` | List/Create news |
| PATCH/DELETE | `/api/news/[id]` | Update/Delete news |
| GET/POST | `/api/events` | List/Create events |
| PATCH/DELETE | `/api/events/[id]` | Update/Delete events |
| GET/POST | `/api/grants` | List/Create grants |
| PATCH/DELETE | `/api/grants/[id]` | Update/Delete grants |
| GET/POST | `/api/announcements` | List/Create announcements |
| DELETE | `/api/announcements/[id]` | Delete announcement |
| GET/POST | `/api/hero-slides` | List/Create hero slides |

### Storage Endpoints (1 endpoint)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/storage/[...path]` | Proxy file from MinIO |

### Dashboard Internal Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/internal/users/upsert` | User sync from CoE |
| GET | `/api/internal/users/lookup` | User lookup by UID |

## Database Models (Complete List)

### CoE Portal Models (alphabetical)

- `Announcement` — Expiring announcements on homepage
- `Application` — Student applications to open problems
- `ApplicationAnswer` — Answers to problem-specific questions
- `Booking` — Facility booking requests
- `Claim` — Hackathon team claims
- `ClaimMember` — Members of a hackathon team
- `EmailJob` — Queued email delivery jobs
- `Event` — Calendar events
- `FacultyProfile` — Faculty profile extensions
- `Grant` — Research grants and scholarships
- `HackathonEvent` — Hackathon event definitions
- `HackathonInterest` — Student interest in hackathons
- `HackathonSessionUploadLock` — Session upload controls
- `HeroSlide` — Homepage carousel slides
- `HostingRequest` — Project hosting requests
- `HostingRequestStatusHistory` — Hosting request audit trail
- `ImpersonationSession` — Admin impersonation sessions
- `Industry` — Industry partner organizations
- `InnovationProgram` — Innovation program events
- `InternshipDocument` — Internship workspace documents
- `InternshipMeeting` — Internship workspace meetings
- `InternshipMessage` — Internship workspace messages
- `InternshipTask` — Internship workspace tasks
- `NewsPost` — News articles
- `Notification` — In-app notifications
- `Otp` — One-time passwords for verification
- `Problem` — Innovation problems (open/hackathon/internship)
- `ProblemQuestion` — Custom questions on problems
- `ProgramInterest` — Interest in innovation programs
- `SessionDocument` — Hackathon session documents
- `StudentProfile` — Student profile for innovation
- `Ticket` — Generated PDF tickets
- `TicketAttendance` — Per-member attendance tracking
- `User` — All user accounts

### Project Dashboard Models

- `User` — Dashboard users (synced from CoE)
- `Project` — Academic projects
- `ProjectMember` — Student members of projects
- `Task`, `Milestone`, `Review`, `ReviewCriteria` — Project management
- `ProjectFile`, `Comment` — Project artifacts
- `Notification` — Dashboard notifications
- `EmailQueue` — Queued email jobs
- `PendingProjectAssignment` — Invited users not yet registered
- `ShowcaseProject`, `ProjectVersion`, `ReviewFeedback`, `ProjectAsset`, `ShowcaseTeamMember` — Showcase system
