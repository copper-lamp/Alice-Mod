!macro customLeaveDir
  StrCpy $0 "$INSTDIR" -9
  StrCmp $0 "\AliceApp" 0 +2
  Goto done

  StrCpy $INSTDIR "$INSTDIR\AliceApp"

done:
!macroend
