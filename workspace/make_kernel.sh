#!/bin/bash
#
# Copyright (c) 2015 by Solectria, A Yaskawa Company. All rights reserved.
#
# History:
# 2015-05-19 ASW, initial version
# 2015-08-27 JHE, update for 4.1.x kernel and cryptodev module
#
# Build the kernel and modules
#
# -----------------------------------------------------------------------------

# print script commands as they execute
set -x

# It is assumed that you are working in a copy of the SVN repository.
# Predefine the path to your workspace before running this setup script.
#
#WORKSPACE=/job/Yellowstone-Kernel/ws/
KERNEL_VERSION=4.7.5
CRYPTODEV_VERSION=1.8
TOOLCHAIN=gcc-linaro-arm-linux-gnueabihf
ARM_CROSS_COMPILE=arm-linux-gnueabihf-
WS_TEMP=$HOME/yellowstone-kernel-tmp
WS_OUT=$HOME/yellowstone-kernel-staging

if [ "$WORKSPACE" == "" ] ; then

    echo "WORKSPACE is undefined."
    echo "Re-defining it to "$HOME
    WORKSPACE=$HOME
fi

echo "-------------------------------------------------------------------------"
echo "...temp directory is"
sudo rm -Rf $WS_TEMP
echo $WS_TEMP
mkdir $WS_TEMP 2>&1 >/dev/null

echo "-------------------------------------------------------------------------"
echo "...staging directory is"
echo $WS_OUT
sudo rm -Rf $WS_OUT
mkdir $WS_OUT 2>&1 >/dev/null

export PATH=/opt/$TOOLCHAIN/bin:$PATH
cd $WS_TEMP

echo "-------------------------------------------------------------------------"
echo "...installing kernel source code"
tar xvf $WORKSPACE/kernel/linux-$KERNEL_VERSION.tar.xz -C $WS_TEMP 2>&1 >/dev/null

echo "-------------------------------------------------------------------------"
echo "...patching the kernel"
cd $WS_TEMP/linux-$KERNEL_VERSION

patch -p1 < $WORKSPACE/kernel/0001-kernel-4.7.x-imx6-2016-09-21.patch 2>&1 >/dev/null
patch -p1 < $WORKSPACE/kernel/0002-kernel-4.7.x-ath9k-intermediate-queues-2016-07-06.patch 2>&1 >/dev/null
patch -p1 < $WORKSPACE/kernel/0003-kernel-4.7.x-mac80211-fq_codel-2016-07-07.patch 2>&1 >/dev/null
patch -p1 < $WORKSPACE/kernel/0004-kernel-4.7.x-mac80211-airtime-fairness-metric-2016-07-11.patch 2>&1 >/dev/null
patch -p1 < $WORKSPACE/kernel/0005-kernel-4.7.x-ti-mesh-fixes-2016-07-12.patch 2>&1 >/dev/null
patch -p1 < $WORKSPACE/kernel/0006-kernel-4.7.x-ath9k-silex-fix-2016-08-07.patch 2>&1 >/dev/null
patch -p1 < $WORKSPACE/kernel/0007-kernel-4.7.x-ath9k-superchannels-power-2016-08-07.patch 2>&1 >/dev/null

echo "-------------------------------------------------------------------------"
echo "...cross-compiling the kernel"
cd $WS_TEMP/linux-$KERNEL_VERSION
KERNEL_DIR=$WS_TEMP/linux-$KERNEL_VERSION ARCH=arm CROSS_COMPILE=arm-linux-gnueabihf- INSTALL_PATH=$WS_OUT INSTALL_MOD_PATH=$WS_OUT INSTALL_FW_PATH=$WS_OUT LOADADDR=0x10008000 make solectria_defconfig 2>&1 >/dev/null
KERNEL_DIR=$WS_TEMP/linux-$KERNEL_VERSION ARCH=arm CROSS_COMPILE=arm-linux-gnueabihf- INSTALL_PATH=$WS_OUT INSTALL_MOD_PATH=$WS_OUT INSTALL_FW_PATH=$WS_OUT LOADADDR=0x10008000 make -j4 2>&1 >/dev/null

echo "-------------------------------------------------------------------------"
echo "...building the kernel image" 
cd $WS_TEMP/linux-$KERNEL_VERSION
KERNEL_DIR=$WS_TEMP/linux-$KERNEL_VERSION ARCH=arm CROSS_COMPILE=$ARM_CROSS_COMPILE INSTALL_PATH=$WS_OUT INSTALL_MOD_PATH=$WS_OUT INSTALL_FW_PATH=$WS_OUT LOADADDR=0x10008000 make -j4 zImage uImage 2>&1 >/dev/null

echo "-------------------------------------------------------------------------"
echo "...building the device tree database"
cd $WS_TEMP/linux-$KERNEL_VERSION
KERNEL_DIR=$WS_TEMP/linux-$KERNEL_VERSION ARCH=arm CROSS_COMPILE=$ARM_CROSS_COMPILE INSTALL_PATH=$WS_OUT INSTALL_MOD_PATH=$WS_OUT INSTALL_FW_PATH=$WS_OUT LOADADDR=0x10008000 make -j4 dtbs 2>&1 >/dev/null

echo "-------------------------------------------------------------------------"
echo "...building the kernel modules"
cd $WS_TEMP/linux-$KERNEL_VERSION
KERNEL_DIR=$WS_TEMP/linux-$KERNEL_VERSION ARCH=arm CROSS_COMPILE=$ARM_CROSS_COMPILE INSTALL_PATH=$WS_OUT INSTALL_MOD_PATH=$WS_OUT INSTALL_FW_PATH=$WS_OUT LOADADDR=0x10008000 make -j4 modules 2>&1 >/dev/null

echo "-------------------------------------------------------------------------"
echo "...installing the kernel modules"
cd $WS_TEMP/linux-$KERNEL_VERSION
KERNEL_DIR=$WS_TEMP/linux-$KERNEL_VERSION ARCH=arm CROSS_COMPILE=$ARM_CROSS_COMPILE INSTALL_PATH=$WS_OUT INSTALL_MOD_PATH=$WS_OUT INSTALL_FW_PATH=$WS_OUT LOADADDR=0x10008000 make -j4 modules_install 2>&1 >/dev/null

echo "-------------------------------------------------------------------------"
echo "...installing the firmware"
cd $WS_TEMP/linux-$KERNEL_VERSION
KERNEL_DIR=$WS_TEMP/linux-$KERNEL_VERSION ARCH=arm CROSS_COMPILE=$ARM_CROSS_COMPILE INSTALL_PATH=$WS_OUT INSTALL_MOD_PATH=$WS_OUT INSTALL_FW_PATH=$WS_OUT LOADADDR=0x10008000 make -j4 firmware_install 2>&1 >/dev/null

echo "-------------------------------------------------------------------------"
echo "...building the cryptodev kernel module"
tar xvf $WORKSPACE/src/cryptodev/cryptodev-linux-$CRYPTODEV_VERSION.tar.gz -C $WS_TEMP 2>&1 >/dev/null
cd $WS_TEMP
cd $WS_TEMP/cryptodev-linux-$CRYPTODEV_VERSION
patch -p1 < $WORKSPACE/src/cryptodev/0001-cryptodev-1.8_linux-4.7.x_2016-06-27.patch 2>&1 >/dev/null

KERNEL_DIR=$WS_TEMP/linux-$KERNEL_VERSION ARCH=arm CROSS_COMPILE=$ARM_CROSS_COMPILE INSTALL_PATH=$WS_OUT INSTALL_MOD_PATH=$WS_OUT INSTALL_FW_PATH=$WS_TEMP make clean 2>&1 > /dev/null
KERNEL_DIR=$WS_TEMP/linux-$KERNEL_VERSION ARCH=arm CROSS_COMPILE=$ARM_CROSS_COMPILE INSTALL_PATH=$WS_OUT INSTALL_MOD_PATH=$WS_OUT INSTALL_FW_PATH=$WS_TEMP make 2>&1 > /dev/null
KERNEL_DIR=$WS_TEMP/linux-$KERNEL_VERSION ARCH=arm CROSS_COMPILE=$ARM_CROSS_COMPILE INSTALL_PATH=$WS_OUT INSTALL_MOD_PATH=$WS_OUT INSTALL_FW_PATH=$WS_TEMP make  install 2>&1 > /dev/null

echo "-------------------------------------------------------------------------"
echo "...installing the kernel"
cd $WS_TEMP/linux-$KERNEL_VERSION
KERNEL_DIR=$WS_TEMP/linux-$KERNEL_VERSION ARCH=arm CROSS_COMPILE=$ARM_CROSS_COMPILE INSTALL_PATH=$WS_TEMP INSTALL_MOD_PATH=$WS_TEMP INSTALL_FW_PATH=$WS_TEMP LOADADDR=0x10008000 make install 2>&1 >/dev/null

echo "set up kernel components in "$WS_OUT
mkdir $WS_OUT/boot 2>&1 >/dev/null
cp $WS_TEMP/linux-$KERNEL_VERSION/arch/arm/boot/zImage $WS_OUT/boot 2>&1 >/dev/null
cp $WS_TEMP/linux-$KERNEL_VERSION/arch/arm/boot/uImage $WS_OUT/boot 2>&1 >/dev/null
mkdir $WS_OUT/boot/dtbs 2>&1 >/dev/null
cp $WS_TEMP/linux-$KERNEL_VERSION/arch/arm/boot/dts/imx6*var-som*.dtb $WS_OUT/boot/dtbs 2>&1 >/dev/null
cp $WS_TEMP/linux-$KERNEL_VERSION/arch/arm/boot/dts/imx6sx*.dtb $WS_OUT/boot/dtbs 2>&1 >/dev/null

# keep the patched source for developer activities
# rm -Rf $WS_TEMP 2>&1 > /dev/null

echo "...done"
