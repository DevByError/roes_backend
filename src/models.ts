import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "./db";

export const newId = () => crypto.randomUUID();

const id = { type: DataTypes.STRING(36), primaryKey: true, defaultValue: newId };

export class User extends Model<InferAttributes<User>, InferCreationAttributes<User>> {
  declare id: CreationOptional<string>;
  declare role: "mayor" | "admin" | "user";
  declare name: string;
  declare email: string;
  declare phone: CreationOptional<string>;
  declare passwordHash: string;
  declare gender: CreationOptional<"Female" | "Male">;
  declare photo: CreationOptional<string | null>;
  declare photoVersion: CreationOptional<number>;
  declare status: CreationOptional<"active" | "frozen">;
  declare nationalId: CreationOptional<string>;
  declare placeId: CreationOptional<string | null>;
  declare residenceId: CreationOptional<string | null>;
  declare unit: CreationOptional<string>;
  declare promoted: CreationOptional<boolean>;
  declare frozenReason: CreationOptional<string | null>;
  declare frozenAt: CreationOptional<Date | null>;
  declare lastActiveAt: CreationOptional<Date>;
  declare office: CreationOptional<string>;
  declare city: CreationOptional<string>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
User.init(
  {
    id,
    role: { type: DataTypes.ENUM("mayor", "admin", "user"), allowNull: false },
    name: { type: DataTypes.STRING(120), allowNull: false },
    email: { type: DataTypes.STRING(190), allowNull: false, unique: true },
    phone: { type: DataTypes.STRING(40), allowNull: false, defaultValue: "" },
    passwordHash: { type: DataTypes.STRING(255), allowNull: false },
    gender: { type: DataTypes.ENUM("Female", "Male"), allowNull: false, defaultValue: "Female" },
    photo: { type: DataTypes.TEXT("long"), allowNull: true },
    photoVersion: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    status: { type: DataTypes.ENUM("active", "frozen"), allowNull: false, defaultValue: "active" },
    nationalId: { type: DataTypes.STRING(40), allowNull: false, defaultValue: "" },
    placeId: { type: DataTypes.STRING(36), allowNull: true },
    residenceId: { type: DataTypes.STRING(36), allowNull: true },
    unit: { type: DataTypes.STRING(40), allowNull: false, defaultValue: "" },
    promoted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    frozenReason: { type: DataTypes.STRING(255), allowNull: true },
    frozenAt: { type: DataTypes.DATE, allowNull: true },
    lastActiveAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    office: { type: DataTypes.STRING(190), allowNull: false, defaultValue: "" },
    city: { type: DataTypes.STRING(120), allowNull: false, defaultValue: "" },
    createdAt: DataTypes.DATE(3),
    updatedAt: DataTypes.DATE(3),
  },
  { sequelize, tableName: "users", indexes: [{ fields: ["role"] }, { fields: ["place_id"] }] },
);

export class Place extends Model<InferAttributes<Place>, InferCreationAttributes<Place>> {
  declare id: CreationOptional<string>;
  declare name: string;
  declare kind: "residential" | "non-residential";
  declare category: string;
  declare district: string;
  declare address: string;
  declare description: string;
  declare lat: number;
  declare lng: number;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
Place.init(
  {
    id,
    name: { type: DataTypes.STRING(160), allowNull: false },
    kind: { type: DataTypes.ENUM("residential", "non-residential"), allowNull: false },
    category: { type: DataTypes.STRING(80), allowNull: false, defaultValue: "" },
    district: { type: DataTypes.STRING(120), allowNull: false, defaultValue: "" },
    address: { type: DataTypes.STRING(255), allowNull: false, defaultValue: "" },
    description: { type: DataTypes.TEXT, allowNull: false },
    lat: { type: DataTypes.DOUBLE, allowNull: false },
    lng: { type: DataTypes.DOUBLE, allowNull: false },
    createdAt: DataTypes.DATE(3),
    updatedAt: DataTypes.DATE(3),
  },
  { sequelize, tableName: "places" },
);

export class Rule extends Model<InferAttributes<Rule>, InferCreationAttributes<Rule>> {
  declare id: CreationOptional<string>;
  declare placeId: string;
  declare type: "residents" | "visitors";
  declare title: string;
  declare text: string;
  declare category: string;
  declare position: number;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
Rule.init(
  {
    id,
    placeId: { type: DataTypes.STRING(36), allowNull: false },
    type: { type: DataTypes.ENUM("residents", "visitors"), allowNull: false },
    title: { type: DataTypes.STRING(190), allowNull: false },
    text: { type: DataTypes.TEXT, allowNull: false },
    category: { type: DataTypes.STRING(30), allowNull: false, defaultValue: "general" },
    position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    createdAt: DataTypes.DATE(3),
    updatedAt: DataTypes.DATE(3),
  },
  { sequelize, tableName: "rules", indexes: [{ fields: ["place_id", "type", "position"] }] },
);

export class Notice extends Model<InferAttributes<Notice>, InferCreationAttributes<Notice>> {
  declare id: CreationOptional<string>;
  declare placeId: string | null;
  declare audience: "public" | "private";
  declare title: string;
  declare body: string;
  declare pinned: CreationOptional<boolean>;
  declare authorId: string;
  declare authorKind: "mayor" | "admin";
  declare authorName: string;
  declare views: CreationOptional<number>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
Notice.init(
  {
    id,
    placeId: { type: DataTypes.STRING(36), allowNull: true },
    audience: { type: DataTypes.ENUM("public", "private"), allowNull: false },
    title: { type: DataTypes.STRING(190), allowNull: false },
    body: { type: DataTypes.TEXT, allowNull: false },
    pinned: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    authorId: { type: DataTypes.STRING(36), allowNull: false },
    authorKind: { type: DataTypes.ENUM("mayor", "admin"), allowNull: false },
    authorName: { type: DataTypes.STRING(120), allowNull: false },
    views: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    createdAt: DataTypes.DATE(3),
    updatedAt: DataTypes.DATE(3),
  },
  { sequelize, tableName: "notices", indexes: [{ fields: ["place_id"] }] },
);

export class NoticeSeen extends Model<InferAttributes<NoticeSeen>, InferCreationAttributes<NoticeSeen>> {
  declare userId: string;
  declare noticeId: string;
}
NoticeSeen.init(
  {
    userId: { type: DataTypes.STRING(36), primaryKey: true },
    noticeId: { type: DataTypes.STRING(36), primaryKey: true },
  },
  { sequelize, tableName: "notice_seen", timestamps: false },
);

export class Complaint extends Model<InferAttributes<Complaint>, InferCreationAttributes<Complaint>> {
  declare id: CreationOptional<string>;
  declare placeId: string | null;
  declare kind: "private" | "place" | "public";
  declare subject: string;
  declare category: string;
  declare priority: "low" | "medium" | "high";
  declare status: CreationOptional<"new" | "in_review" | "resolved" | "rejected">;
  declare fromId: string;
  declare staffUnread: CreationOptional<boolean>;
  declare userUnread: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
Complaint.init(
  {
    id,
    placeId: { type: DataTypes.STRING(36), allowNull: true },
    kind: { type: DataTypes.ENUM("private", "place", "public"), allowNull: false },
    subject: { type: DataTypes.STRING(190), allowNull: false },
    category: { type: DataTypes.STRING(80), allowNull: false, defaultValue: "General" },
    priority: { type: DataTypes.ENUM("low", "medium", "high"), allowNull: false, defaultValue: "medium" },
    status: { type: DataTypes.ENUM("new", "in_review", "resolved", "rejected"), allowNull: false, defaultValue: "new" },
    fromId: { type: DataTypes.STRING(36), allowNull: false },
    staffUnread: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    userUnread: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    createdAt: DataTypes.DATE(3),
    updatedAt: DataTypes.DATE(3),
  },
  { sequelize, tableName: "complaints", indexes: [{ fields: ["place_id"] }, { fields: ["from_id"] }, { fields: ["kind"] }] },
);

export class ComplaintMessage extends Model<InferAttributes<ComplaintMessage>, InferCreationAttributes<ComplaintMessage>> {
  declare id: CreationOptional<string>;
  declare complaintId: string;
  declare from: "user" | "staff";
  declare text: string;
  declare createdAt: CreationOptional<Date>;
}
ComplaintMessage.init(
  {
    id,
    complaintId: { type: DataTypes.STRING(36), allowNull: false },
    from: { type: DataTypes.ENUM("user", "staff"), allowNull: false },
    text: { type: DataTypes.TEXT, allowNull: false },
    createdAt: DataTypes.DATE(3),
  },
  { sequelize, tableName: "complaint_messages", updatedAt: false, indexes: [{ fields: ["complaint_id"] }] },
);

export class Report extends Model<InferAttributes<Report>, InferCreationAttributes<Report>> {
  declare id: CreationOptional<string>;
  declare placeId: string;
  declare fromId: string;
  declare againstId: string;
  declare category: string;
  declare subject: string;
  declare status: CreationOptional<"open" | "resolved" | "escalated">;
  declare strikes: CreationOptional<number>;
  declare unreadFor: CreationOptional<string[]>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
Report.init(
  {
    id,
    placeId: { type: DataTypes.STRING(36), allowNull: false },
    fromId: { type: DataTypes.STRING(36), allowNull: false },
    againstId: { type: DataTypes.STRING(36), allowNull: false },
    category: { type: DataTypes.STRING(30), allowNull: false, defaultValue: "general" },
    subject: { type: DataTypes.STRING(190), allowNull: false },
    status: { type: DataTypes.ENUM("open", "resolved", "escalated"), allowNull: false, defaultValue: "open" },
    strikes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    unreadFor: { type: DataTypes.JSON, allowNull: true },
    createdAt: DataTypes.DATE(3),
    updatedAt: DataTypes.DATE(3),
  },
  { sequelize, tableName: "reports", indexes: [{ fields: ["place_id"] }, { fields: ["from_id"] }] },
);

export class ReportMessage extends Model<InferAttributes<ReportMessage>, InferCreationAttributes<ReportMessage>> {
  declare id: CreationOptional<string>;
  declare reportId: string;
  declare fromId: string;
  declare text: string;
  declare flagged: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
}
ReportMessage.init(
  {
    id,
    reportId: { type: DataTypes.STRING(36), allowNull: false },
    fromId: { type: DataTypes.STRING(36), allowNull: false },
    text: { type: DataTypes.TEXT, allowNull: false },
    flagged: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    createdAt: DataTypes.DATE(3),
  },
  { sequelize, tableName: "report_messages", updatedAt: false, indexes: [{ fields: ["report_id"] }] },
);

export class PlaceReport extends Model<InferAttributes<PlaceReport>, InferCreationAttributes<PlaceReport>> {
  declare id: CreationOptional<string>;
  declare placeId: string;
  declare fromId: string;
  declare category: string;
  declare subject: string;
  declare details: string;
  declare createdAt: CreationOptional<Date>;
}
PlaceReport.init(
  {
    id,
    placeId: { type: DataTypes.STRING(36), allowNull: false },
    fromId: { type: DataTypes.STRING(36), allowNull: false },
    category: { type: DataTypes.STRING(30), allowNull: false, defaultValue: "general" },
    subject: { type: DataTypes.STRING(190), allowNull: false },
    details: { type: DataTypes.TEXT, allowNull: false },
    createdAt: DataTypes.DATE(3),
  },
  { sequelize, tableName: "place_reports", updatedAt: false, indexes: [{ fields: ["place_id"] }] },
);

export class Donation extends Model<InferAttributes<Donation>, InferCreationAttributes<Donation>> {
  declare id: CreationOptional<string>;
  declare title: string;
  declare category: string;
  declare description: string;
  declare goal: number;
  declare raised: CreationOptional<number>;
  declare donors: CreationOptional<number>;
  declare deadline: string;
  declare status: CreationOptional<"active" | "closed">;
  declare cover: CreationOptional<"flood" | "school" | "kitchen" | "hospital">;
  declare image: CreationOptional<string | null>;
  declare imageVersion: CreationOptional<number>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
Donation.init(
  {
    id,
    title: { type: DataTypes.STRING(190), allowNull: false },
    category: { type: DataTypes.STRING(80), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: false },
    goal: { type: DataTypes.DOUBLE, allowNull: false },
    raised: { type: DataTypes.DOUBLE, allowNull: false, defaultValue: 0 },
    donors: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    deadline: { type: DataTypes.STRING(40), allowNull: false },
    status: { type: DataTypes.ENUM("active", "closed"), allowNull: false, defaultValue: "active" },
    cover: { type: DataTypes.ENUM("flood", "school", "kitchen", "hospital"), allowNull: false, defaultValue: "flood" },
    image: { type: DataTypes.TEXT("long"), allowNull: true },
    imageVersion: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    createdAt: DataTypes.DATE(3),
    updatedAt: DataTypes.DATE(3),
  },
  { sequelize, tableName: "donations" },
);

export class Pledge extends Model<InferAttributes<Pledge>, InferCreationAttributes<Pledge>> {
  declare id: CreationOptional<string>;
  declare donationId: string;
  declare userId: string;
  declare amount: number;
  declare createdAt: CreationOptional<Date>;
}
Pledge.init(
  {
    id,
    donationId: { type: DataTypes.STRING(36), allowNull: false },
    userId: { type: DataTypes.STRING(36), allowNull: false },
    amount: { type: DataTypes.DOUBLE, allowNull: false },
    createdAt: DataTypes.DATE(3),
  },
  { sequelize, tableName: "pledges", updatedAt: false, indexes: [{ fields: ["donation_id", "user_id"] }] },
);

export class Policy extends Model<InferAttributes<Policy>, InferCreationAttributes<Policy>> {
  declare id: CreationOptional<string>;
  declare title: string;
  declare category: string;
  declare severity: "info" | "important" | "critical";
  declare summary: string;
  declare content: string;
  declare published: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
Policy.init(
  {
    id,
    title: { type: DataTypes.STRING(190), allowNull: false },
    category: { type: DataTypes.STRING(40), allowNull: false },
    severity: { type: DataTypes.ENUM("info", "important", "critical"), allowNull: false },
    summary: { type: DataTypes.TEXT, allowNull: false },
    content: { type: DataTypes.TEXT, allowNull: false },
    published: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    createdAt: DataTypes.DATE(3),
    updatedAt: DataTypes.DATE(3),
  },
  { sequelize, tableName: "policies" },
);

export class GameScore extends Model<InferAttributes<GameScore>, InferCreationAttributes<GameScore>> {
  declare userId: string;
  declare nick: string;
  declare best: CreationOptional<number>;
}
GameScore.init(
  {
    userId: { type: DataTypes.STRING(36), primaryKey: true },
    nick: { type: DataTypes.STRING(30), allowNull: false, unique: true },
    best: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  },
  { sequelize, tableName: "game_scores", timestamps: false },
);

export class Activity extends Model<InferAttributes<Activity>, InferCreationAttributes<Activity>> {
  declare id: CreationOptional<string>;
  declare kind: "user" | "complaint" | "admin" | "donation" | "policy" | "announcement";
  declare text: string;
  declare createdAt: CreationOptional<Date>;
}
Activity.init(
  {
    id,
    kind: { type: DataTypes.ENUM("user", "complaint", "admin", "donation", "policy", "announcement"), allowNull: false },
    text: { type: DataTypes.STRING(255), allowNull: false },
    createdAt: DataTypes.DATE(3),
  },
  { sequelize, tableName: "activity", updatedAt: false },
);

export class VerificationCode extends Model<InferAttributes<VerificationCode>, InferCreationAttributes<VerificationCode>> {
  declare id: CreationOptional<string>;
  declare email: string;
  declare purpose: "register" | "reset";
  declare codeHash: string;
  declare expiresAt: Date;
  declare attempts: CreationOptional<number>;
  declare verified: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
}
VerificationCode.init(
  {
    id,
    email: { type: DataTypes.STRING(190), allowNull: false },
    purpose: { type: DataTypes.ENUM("register", "reset"), allowNull: false },
    codeHash: { type: DataTypes.STRING(255), allowNull: false },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
    attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    verified: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    createdAt: DataTypes.DATE(3),
  },
  { sequelize, tableName: "verification_codes", updatedAt: false, indexes: [{ fields: ["email", "purpose"] }] },
);

Rule.belongsTo(Place, { foreignKey: "placeId", constraints: false });
Place.hasMany(Rule, { foreignKey: "placeId", as: "rules", constraints: false });
Complaint.hasMany(ComplaintMessage, { foreignKey: "complaintId", as: "messages", constraints: false });
Report.hasMany(ReportMessage, { foreignKey: "reportId", as: "messages", constraints: false });
