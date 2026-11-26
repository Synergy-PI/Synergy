-- CreateTable
CREATE TABLE `UserAiKey` (
    `userId` VARCHAR(191) NOT NULL,
    `ciphertext` VARCHAR(600) NOT NULL,
    `last4` CHAR(4) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TenderAnalysis` (
    `tenderId` VARCHAR(191) NOT NULL,
    `status` ENUM('PENDING', 'RUNNING', 'SUCCEEDED', 'UNAVAILABLE') NOT NULL DEFAULT 'PENDING',
    `priority` INTEGER NOT NULL DEFAULT 0,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `nextAttemptAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `heartbeatAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `error` VARCHAR(300) NULL,
    `documents` JSON NULL,
    `requirementCount` INTEGER NOT NULL DEFAULT 0,
    `aiStatus` ENUM('NONE', 'PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED') NOT NULL DEFAULT 'NONE',
    `aiModel` VARCHAR(191) NULL,
    `aiError` VARCHAR(300) NULL,
    `aiHeartbeatAt` DATETIME(3) NULL,
    `aiCompletedAt` DATETIME(3) NULL,
    `aiRequestedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `TenderAnalysis_status_nextAttemptAt_idx`(`status`, `nextAttemptAt`),
    INDEX `TenderAnalysis_aiStatus_idx`(`aiStatus`),
    INDEX `TenderAnalysis_aiRequestedById_idx`(`aiRequestedById`),
    PRIMARY KEY (`tenderId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TenderRequirement` (
    `id` VARCHAR(191) NOT NULL,
    `tenderId` VARCHAR(191) NOT NULL,
    `position` INTEGER NOT NULL,
    `category` ENUM('TECHNICAL', 'FINANCIAL', 'LEGAL', 'FISCAL', 'DECLARATION', 'OTHER') NOT NULL,
    `procedural` BOOLEAN NOT NULL DEFAULT false,
    `label` VARCHAR(24) NULL,
    `text` TEXT NOT NULL,
    `documentType` VARCHAR(80) NOT NULL,
    `page` INTEGER NOT NULL,
    `aiCategory` ENUM('TECHNICAL', 'FINANCIAL', 'LEGAL', 'FISCAL', 'DECLARATION', 'OTHER') NULL,
    `aiProcedural` BOOLEAN NULL,
    `aiTitle` VARCHAR(200) NULL,
    `aiHighlight` BOOLEAN NULL,

    UNIQUE INDEX `TenderRequirement_tenderId_position_key`(`tenderId`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `UserAiKey` ADD CONSTRAINT `UserAiKey_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TenderAnalysis` ADD CONSTRAINT `TenderAnalysis_tenderId_fkey` FOREIGN KEY (`tenderId`) REFERENCES `Tender`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TenderAnalysis` ADD CONSTRAINT `TenderAnalysis_aiRequestedById_fkey` FOREIGN KEY (`aiRequestedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TenderRequirement` ADD CONSTRAINT `TenderRequirement_tenderId_fkey` FOREIGN KEY (`tenderId`) REFERENCES `TenderAnalysis`(`tenderId`) ON DELETE CASCADE ON UPDATE CASCADE;
