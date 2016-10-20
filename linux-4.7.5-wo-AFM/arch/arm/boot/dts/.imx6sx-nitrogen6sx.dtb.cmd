cmd_arch/arm/boot/dts/imx6sx-nitrogen6sx.dtb := mkdir -p arch/arm/boot/dts/ ; arm-linux-gnueabihf-gcc -E -Wp,-MD,arch/arm/boot/dts/.imx6sx-nitrogen6sx.dtb.d.pre.tmp -nostdinc -I./arch/arm/boot/dts -I./arch/arm/boot/dts/include -I./drivers/of/testcase-data -undef -D__DTS__ -x assembler-with-cpp -o arch/arm/boot/dts/.imx6sx-nitrogen6sx.dtb.dts.tmp arch/arm/boot/dts/imx6sx-nitrogen6sx.dts ; ./scripts/dtc/dtc -O dtb -o arch/arm/boot/dts/imx6sx-nitrogen6sx.dtb -b 0 -i arch/arm/boot/dts/ -Wno-unit_address_vs_reg -d arch/arm/boot/dts/.imx6sx-nitrogen6sx.dtb.d.dtc.tmp arch/arm/boot/dts/.imx6sx-nitrogen6sx.dtb.dts.tmp ; cat arch/arm/boot/dts/.imx6sx-nitrogen6sx.dtb.d.pre.tmp arch/arm/boot/dts/.imx6sx-nitrogen6sx.dtb.d.dtc.tmp > arch/arm/boot/dts/.imx6sx-nitrogen6sx.dtb.d

source_arch/arm/boot/dts/imx6sx-nitrogen6sx.dtb := arch/arm/boot/dts/imx6sx-nitrogen6sx.dts

deps_arch/arm/boot/dts/imx6sx-nitrogen6sx.dtb := \
  arch/arm/boot/dts/imx6sx.dtsi \
  arch/arm/boot/dts/include/dt-bindings/clock/imx6sx-clock.h \
  arch/arm/boot/dts/include/dt-bindings/gpio/gpio.h \
  arch/arm/boot/dts/include/dt-bindings/input/input.h \
  arch/arm/boot/dts/include/dt-bindings/input/linux-event-codes.h \
  arch/arm/boot/dts/include/dt-bindings/interrupt-controller/arm-gic.h \
  arch/arm/boot/dts/include/dt-bindings/interrupt-controller/irq.h \
  arch/arm/boot/dts/imx6sx-pinfunc.h \
  arch/arm/boot/dts/skeleton.dtsi \

arch/arm/boot/dts/imx6sx-nitrogen6sx.dtb: $(deps_arch/arm/boot/dts/imx6sx-nitrogen6sx.dtb)

$(deps_arch/arm/boot/dts/imx6sx-nitrogen6sx.dtb):
