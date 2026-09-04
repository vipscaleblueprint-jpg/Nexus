/**
 * Request/response contracts for the HTTP API.
 * Shared verbatim between server and client - keep both copies in sync.
 */

import type { Doc, Folder, List, Page, Space, Task, Team, User } from './models';

/** Every error response the server sends uses this shape. */
export interface ApiError {
  error: string;
  message?: string;
}

export interface MessageResponse {
  message: string;
}

// --- auth ---

export interface LoginParams {
  email: string;
  password: string;
  rememberMe?: boolean;
}

export interface AuthResponse {
  user: User;
  rememberMe?: boolean;
}

export interface UserResponse {
  user: User;
}

export interface UpdateProfileParams {
  name?: string;
  avatarUrl?: string;
  dailySheetUrl?: string;
}

export interface ChangePasswordParams {
  currentPassword?: string;
  newPassword: string;
}

export interface ForgotPasswordParams {
  email: string;
}

export interface ResetPasswordParams {
  email: string;
  otp: string;
  newPassword: string;
}

// --- users ---

export interface UsersResponse {
  users: User[];
}

export interface TeamsResponse {
  teams: Team[];
}

// --- spaces / folders / docs / pages / lists ---

export interface SpacesResponse {
  spaces: Space[];
}

export interface SpaceResponse {
  space: Space;
}

export interface CreateSpaceParams {
  name: string;
  icon?: string;
  color?: string;
  ownerId: string;
}

export interface FolderResponse {
  folder: Folder;
}

export interface CreateFolderParams {
  name: string;
  spaceId?: string;
  parentFolderId?: string;
}

export interface DocResponse {
  doc: Doc;
}

export interface CreateDocParams {
  title: string;
  spaceId?: string;
  folderId?: string;
}

export interface UpdateDocParams {
  title?: string;
  docDate?: string;
}

export interface PageResponse {
  page: Page;
}

export interface CreatePageParams {
  title?: string;
  content?: string;
  docId: string;
  parentPageId?: string;
}

export interface UpdatePageParams {
  title?: string;
  content?: string;
}

export interface ListResponse {
  list: List;
}

export interface CreateListParams {
  name: string;
  spaceId?: string;
  folderId?: string;
}

// --- tasks ---

export interface TasksResponse {
  tasks: Task[];
}

export interface TaskResponse {
  task: Task;
}

export type CreateTaskParams = Partial<Task>;
export type UpdateTaskParams = Partial<Task>;
