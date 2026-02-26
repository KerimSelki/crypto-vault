// ═══ TEFAS Fon Verileri ═══
const t = (id, symbol, name, sector, fundType) => ({ id, symbol, name, market: "tefas", currency: "₺", sector, fundType });

export const TEFAS_DATA = {
  "IPB": t("IPB","IPB","İş Portföy BIST 100 Fonu","Hisse Fonu","Hisse"),
  "TI2": t("TI2","TI2","İş Portföy Borçlanma Fonu","Borçlanma","Borçlanma"),
  "YAC": t("YAC","YAC","Yapı Kredi Agresif Fon","Karma Fon","Değişken"),
  "MAC": t("MAC","MAC","Marmara Cap. Değişken Fon","Karma Fon","Değişken"),
  "GAE": t("GAE","GAE","Garanti Emeklilik Fonu","Emeklilik","Emeklilik"),
  "OFA": t("OFA","OFA","OYAK Altın Fonu","Altın Fonu","Altın"),
  "AK2": t("AK2","AK2","Ak Portföy Amerikan Fon","Yabancı Fon","Yabancı"),
  "ZPX": t("ZPX","ZPX","Ziraat BIST 30 Fonu","Hisse Fonu","Hisse"),
  "TCD": t("TCD","TCD","TEB Portföy Değişken Fon","Karma Fon","Değişken"),
  "AFT": t("AFT","AFT","Ak Portföy BIST Temettü Fonu","Hisse Fonu","Hisse"),
  "DZE": t("DZE","DZE","Deniz Portföy Eurobond Fonu","Borçlanma","Eurobond"),
  "IYH": t("IYH","IYH","İş Portföy Yab. Hisse Fonu","Yabancı Fon","Yabancı"),
};
