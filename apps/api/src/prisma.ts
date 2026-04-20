import { loadPrismaClientPackage } from "./prisma-client-package.js";

const prismaClientPackage = loadPrismaClientPackage();
const { PrismaClient } = prismaClientPackage;

export const prisma = new PrismaClient();
