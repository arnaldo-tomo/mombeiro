import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Image,
  Alert,
  ScrollView,
  Platform,
  StatusBar,
  SafeAreaView,
  ActivityIndicator,
  Dimensions,
  Animated,
  RefreshControl,
  Linking,
  BackHandler,
  Vibration,
  AppState,
} from 'react-native';
import { Camera, CameraType } from 'expo-camera';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { Audio } from 'expo-av';
import { Video } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { Accelerometer } from 'expo-sensors';
import * as Haptics from 'expo-haptics';
import { useColorScheme } from 'react-native';

const { width, height } = Dimensions.get('window');

const API_BASE_URL = 'https://bombeiro.visionmoz.online/api';

const FireAlertApp = () => {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  
  // State variables
  const [step, setStep] = useState(1); // 1: Register, 2: Alert, 3: History, 4: Panic
  const [userName, setUserName] = useState('');
  const [userPhone, setUserPhone] = useState('');
  const [message, setMessage] = useState('');
  const [photo, setPhoto] = useState(null);
  const [video, setVideo] = useState(null);
  const [audioRecording, setAudioRecording] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isRecordingVideo, setIsRecordingVideo] = useState(false);
  const [location, setLocation] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [isConnected, setIsConnected] = useState(true);
  const [pendingAlerts, setPendingAlerts] = useState([]);
  const [panicMode, setPanicMode] = useState(false);
  const [shakeDetection, setShakeDetection] = useState(true);
  const [emergencyContacts, setEmergencyContacts] = useState(['193', '112']);
  
  // Animations
  const [fadeAnim] = useState(new Animated.Value(0));
  const [slideAnim] = useState(new Animated.Value(50));
  const [pulseAnim] = useState(new Animated.Value(1));
  const [panicAnim] = useState(new Animated.Value(1));
  const [shakeAnim] = useState(new Animated.Value(0));
  
  // Refs
  const scrollViewRef = useRef(null);
  const cameraRef = useRef(null);
  const recordingRef = useRef(null);
  const videoRef = useRef(null);

  useEffect(() => {
    initializeApp();
    setupNetworkListener();
    setupBackHandler();
    setupShakeDetection();
    setupAppStateListener();
    animateIn();
  }, []);

  useEffect(() => {
    if (step === 1) {
      loadStoredUserData();
    } else if (step === 3) {
      loadAlerts();
    }
  }, [step]);

  const setupAppStateListener = () => {
    const handleAppStateChange = (nextAppState) => {
      if (nextAppState === 'background' && panicMode) {
        // Keep panic mode active in background
        Vibration.vibrate([1000, 1000, 1000], true);
      }
    };
    
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription?.remove();
  };

  const setupBackHandler = () => {
    const backAction = () => {
      if (step === 2) {
        setStep(1);
        return true;
      } else if (step === 3) {
        setStep(2);
        return true;
      } else if (step === 4) {
        setPanicMode(false);
        setStep(2);
        Vibration.cancel();
        return true;
      }
      return false;
    };

    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove();
  };

  const setupNetworkListener = () => {
    const unsubscribe = NetInfo.addEventListener(state => {
      setIsConnected(state.isConnected);
      if (state.isConnected && pendingAlerts.length > 0) {
        processPendingAlerts();
      }
    });
    return unsubscribe;
  };

  const setupShakeDetection = () => {
    if (!shakeDetection) return;
    
    Accelerometer.setUpdateInterval(100);
    
    const subscription = Accelerometer.addListener(({ x, y, z }) => {
      const acceleration = Math.sqrt(x * x + y * y + z * z);
      
      if (acceleration > 2.5 && !panicMode) {
        triggerShakeAlert();
      }
    });
    
    return () => subscription && subscription.remove();
  };

  const triggerShakeAlert = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    
    Alert.alert(
      '🚨 DETECÇÃO DE MOVIMENTO',
      'Detectamos um movimento brusco! Você está em uma emergência?',
      [
        {
          text: 'Cancelar',
          style: 'cancel',
          onPress: () => {}
        },
        {
          text: 'SIM - EMERGÊNCIA!',
          style: 'destructive',
          onPress: activatePanicMode
        }
      ]
    );
  };

  const activatePanicMode = async () => {
    setPanicMode(true);
    setStep(4);
    
    // Haptic feedback intenso
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    Vibration.vibrate([500, 500, 500], true);
    
    // Animação de pânico
    Animated.loop(
      Animated.sequence([
        Animated.timing(panicAnim, {
          toValue: 1.2,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(panicAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ])
    ).start();
    
    // Auto-envio de alerta de emergência
    setTimeout(() => {
      autoSendEmergencyAlert();
    }, 3000);
  };

  const autoSendEmergencyAlert = async () => {
    if (!location) {
      await getCurrentLocation();
    }
    
    const emergencyData = {
      userName: userName || 'Usuário de Emergência',
      userPhone: userPhone || 'Não informado',
      message: '🚨 ALERTA AUTOMÁTICO - EMERGÊNCIA DETECTADA POR MOVIMENTO BRUSCO',
      location,
      photo: null,
      video: null,
      audio: null,
      timestamp: new Date().toISOString(),
      isEmergency: true
    };
    
    try {
      await sendAlertToServer(emergencyData);
      
      // Ligar automaticamente para emergência
      setTimeout(() => {
        callEmergencyServices();
      }, 2000);
      
    } catch (error) {
      console.error('Erro no envio automático:', error);
    }
  };

  const callEmergencyServices = () => {
    Alert.alert(
      '📞 LIGAÇÃO AUTOMÁTICA',
      'Conectando com serviços de emergência...',
      [
        {
          text: 'Bombeiros - 193',
          onPress: () => Linking.openURL('tel:193')
        },
        {
          text: 'Emergência - 112',
          onPress: () => Linking.openURL('tel:112')
        }
      ]
    );
  };

  const initializeApp = async () => {
    await requestPermissions();
    await loadStoredUserData();
  };

  const animateIn = () => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 1000,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 800,
        useNativeDriver: true,
      }),
    ]).start();

    // Start pulse animation for buttons
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    ).start();
  };

  const loadStoredUserData = async () => {
    try {
      const storedName = await AsyncStorage.getItem('userName');
      const storedPhone = await AsyncStorage.getItem('userPhone');
      if (storedName) setUserName(storedName);
      if (storedPhone) setUserPhone(storedPhone);
    } catch (error) {
      console.error('Erro ao carregar dados do usuário:', error);
    }
  };

  const saveUserData = async () => {
    try {
      await AsyncStorage.setItem('userName', userName);
      await AsyncStorage.setItem('userPhone', userPhone);
    } catch (error) {
      console.error('Erro ao salvar dados do usuário:', error);
    }
  };

  const requestPermissions = async () => {
    try {
      // Solicitar permissões de localização
      const { status: locationStatus } = await Location.requestForegroundPermissionsAsync();
      if (locationStatus !== 'granted') {
        Alert.alert(
          'Permissão necessária', 
          'Precisamos da sua localização para enviar alertas de emergência.',
          [
            { text: 'Configurações', onPress: () => Linking.openSettings() },
            { text: 'Cancelar', style: 'cancel' }
          ]
        );
        return;
      }

      // Solicitar permissões de câmera
      const { status: cameraStatus } = await Camera.requestCameraPermissionsAsync();
      if (cameraStatus !== 'granted') {
        Alert.alert(
          'Permissão necessária', 
          'Precisamos acesso à câmera para tirar fotos da emergência.',
          [
            { text: 'Configurações', onPress: () => Linking.openSettings() },
            { text: 'Cancelar', style: 'cancel' }
          ]
        );
      }

      // Solicitar permissões de áudio
      const { status: audioStatus } = await Audio.requestPermissionsAsync();
      if (audioStatus !== 'granted') {
        Alert.alert(
          'Permissão de áudio necessária',
          'Precisamos acesso ao microfone para gravar áudio da emergência.'
        );
      }

      // Obter localização atual
      getCurrentLocation();
    } catch (error) {
      console.error('Erro ao solicitar permissões:', error);
    }
  };

  const getCurrentLocation = async () => {
    try {
      setLoading(true);
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
        timeout: 10000,
      });
      
      const address = await Location.reverseGeocodeAsync({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      });
      
      setLocation({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        address: address[0] ? 
          `${address[0].street || ''}, ${address[0].city || ''}, ${address[0].region || ''}`.replace(/^,\s*/, '') :
          `${location.coords.latitude.toFixed(6)}, ${location.coords.longitude.toFixed(6)}`,
      });
    } catch (error) {
      console.error('Erro de localização:', error);
      Alert.alert(
        'Erro de localização', 
        'Não foi possível obter sua localização. Verifique se o GPS está ativado.',
        [
          { text: 'Tentar novamente', onPress: getCurrentLocation },
          { text: 'Continuar sem localização', style: 'cancel' }
        ]
      );
    } finally {
      setLoading(false);
    }
  };

  const startAudioRecording = async () => {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permissão necessária', 'Precisamos de acesso ao microfone.');
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync(Audio.RECORDING_OPTIONS_PRESET_HIGH_QUALITY);
      await recording.startAsync();
      
      setAudioRecording(recording);
      setIsRecording(true);
      
      // Auto-stop after 15 seconds
      setTimeout(() => {
        if (isRecording) {
          stopAudioRecording();
        }
      }, 15000);
      
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      
    } catch (error) {
      console.error('Erro ao iniciar gravação:', error);
      Alert.alert('Erro', 'Não foi possível iniciar a gravação de áudio.');
    }
  };

  const stopAudioRecording = async () => {
    try {
      if (!audioRecording) return;
      
      setIsRecording(false);
      await audioRecording.stopAndUnloadAsync();
      const uri = audioRecording.getURI();
      
      setAudioRecording({ uri });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      
    } catch (error) {
      console.error('Erro ao parar gravação:', error);
    }
  };

  const startVideoRecording = async () => {
    try {
      if (!cameraRef.current) return;
      
      setIsRecordingVideo(true);
      const video = await cameraRef.current.recordAsync({
        maxDuration: 20, // 20 seconds max
        quality: Camera.Constants.VideoQuality['720p'],
      });
      
      setVideo(video);
      setIsRecordingVideo(false);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      
    } catch (error) {
      console.error('Erro na gravação de vídeo:', error);
      setIsRecordingVideo(false);
      Alert.alert('Erro', 'Não foi possível gravar o vídeo.');
    }
  };

  const stopVideoRecording = async () => {
    try {
      if (cameraRef.current && isRecordingVideo) {
        await cameraRef.current.stopRecording();
      }
    } catch (error) {
      console.error('Erro ao parar vídeo:', error);
    }
  };

  const takePhoto = async () => {
    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [16, 9],
        quality: 0.7,
        exif: false,
      });

      if (!result.canceled) {
        setPhoto(result.assets[0]);
      }
    } catch (error) {
      console.error('Erro ao tirar foto:', error);
      Alert.alert('Erro', 'Não foi possível tirar a foto. Tente novamente.');
    }
  };

  const selectFromGallery = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [16, 9],
        quality: 0.7,
        exif: false,
      });

      if (!result.canceled) {
        setPhoto(result.assets[0]);
      }
    } catch (error) {
      console.error('Erro ao selecionar foto:', error);
      Alert.alert('Erro', 'Não foi possível selecionar a foto.');
    }
  };

  const showPhotoOptions = () => {
    Alert.alert(
      'Adicionar Foto',
      'Escolha uma opção:',
      [
        { text: 'Câmera', onPress: takePhoto },
        { text: 'Galeria', onPress: selectFromGallery },
        { text: 'Cancelar', style: 'cancel' }
      ]
    );
  };

  const processPendingAlerts = async () => {
    for (const alertData of pendingAlerts) {
      try {
        await sendAlertToServer(alertData);
        setPendingAlerts(prev => prev.filter(alert => alert !== alertData));
      } catch (error) {
        console.error('Erro ao processar alerta pendente:', error);
      }
    }
  };

  const sendAlertToServer = async (alertData) => {
    const formData = new FormData();
    formData.append('user_name', alertData.userName);
    formData.append('user_phone', alertData.userPhone);
    formData.append('message', alertData.message);
    formData.append('location', alertData.location.address);
    formData.append('latitude', alertData.location.latitude.toString());
    formData.append('longitude', alertData.location.longitude.toString());
  
    if (alertData.photo) {
      formData.append('photo', {
        uri: Platform.OS === 'ios' ? alertData.photo.uri.replace('file://', '') : alertData.photo.uri,
        type: 'image/jpeg',
        name: 'alert_photo.jpg',
      });
    }
  
    if (alertData.video) {
      formData.append('video', {
        uri: alertData.video.uri,
        type: 'video/mp4',
        name: 'alert_video.mp4',
      });
    }
  
    if (alertData.audio) {
      formData.append('audio', {
        uri: alertData.audio.uri,
        type: 'audio/m4a',
        name: 'alert_audio.m4a',
      });
    }
  
    try {
      const response = await fetch(`${API_BASE_URL}/alerts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        body: formData,
      });
  
      // Log para depuração
      const responseBody = await response.text();
      console.log('Código de Status HTTP:', response.status);
      console.log('Resposta do Servidor:', responseBody);
  
      // Verificar se a resposta é válida
      if (!response.ok && response.status !== 200 && response.status !== 201) {
        throw new Error(`Falha ao enviar alerta: Código ${response.status} - ${responseBody}`);
      }
  
      // Tentar parsear a resposta como JSON
      let jsonResponse;
      try {
        jsonResponse = JSON.parse(responseBody);
      } catch (error) {
        throw new Error(`Erro ao processar resposta do servidor: ${responseBody}`);
      }
  
      return jsonResponse;
    } catch (error) {
      console.error('Erro em sendAlertToServer:', error.message);
      throw error;
    }
  };

  const sendAlert = async () => {
    if (!userName || !userPhone || !location) {
      Alert.alert('Erro', 'Por favor, preencha todos os campos obrigatórios.');
      return;
    }

    const alertData = {
      userName,
      userPhone,
      message,
      location,
      photo,
      video,
      audio: audioRecording,
      timestamp: new Date().toISOString(),
    };

    setLoading(true);

    try {
      await saveUserData();

      if (!isConnected) {
        // Salvar para envio posterior
        setPendingAlerts(prev => [...prev, alertData]);
        Alert.alert(
          'Sem conexão',
          'Seu alerta foi salvo e será enviado automaticamente quando a conexão for restaurada.',
          [{ text: 'OK', onPress: () => clearForm() }]
        );
        return;
      }

      const data = await sendAlertToServer(alertData);

      if (data.success) {
        Alert.alert(
          'Alerta enviado! 🚨',
          'Seu alerta foi enviado com sucesso! Os bombeiros foram notificados e estão a caminho.',
          [
            { 
              text: 'Ver histórico', 
              onPress: () => {
                clearForm();
                setStep(3);
                loadAlerts();
              }
            },
            { 
              text: 'Enviar novo alerta', 
              onPress: clearForm 
            }
          ]
        );
      } else {
        throw new Error('Resposta inválida do servidor');
      }
    } catch (error) {
      console.error('Erro ao enviar alerta:', error);
      
      if (!isConnected) {
        setPendingAlerts(prev => [...prev, alertData]);
        Alert.alert(
          'Alerta salvo offline',
          'Não foi possível conectar ao servidor. Seu alerta foi salvo e será enviado automaticamente quando a conexão for restaurada.'
        );
      } else {
        Alert.alert(
          'Erro de envio',
          'Não foi possível enviar o alerta. Verifique sua conexão e tente novamente.',
          [
            { text: 'Tentar novamente', onPress: sendAlert },
            { text: 'Cancelar', style: 'cancel' }
          ]
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const clearForm = () => {
    setMessage('');
    setPhoto(null);
    setVideo(null);
    setAudioRecording(null);
  };

  const loadAlerts = async () => {
    if (!userPhone) return;

    try {
      const response = await fetch(`${API_BASE_URL}/alerts`);
      const data = await response.json();
      const userAlerts = data.filter(alert => alert.user_phone === userPhone);
      setAlerts(userAlerts);
    } catch (error) {
      console.error('Erro ao carregar alertas:', error);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    if (step === 3) {
      await loadAlerts();
    } else if (step === 1) {
      await getCurrentLocation();
    }
    setRefreshing(false);
  };

  const emergencyCall = () => {
    Alert.alert(
      'Chamada de Emergência',
      'Ligar para o número de emergência 193 (Bombeiros)?',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Ligar', onPress: () => Linking.openURL('tel:193') }
      ]
    );
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'pending': return '#EF4444';
      case 'in_progress': return '#F59E0B';
      case 'resolved': return '#10B981';
      default: return '#6B7280';
    }
  };

  const getStatusText = (status) => {
    switch (status) {
      case 'pending': return 'Pendente';
      case 'in_progress': return 'Em Atendimento';
      case 'resolved': return 'Resolvido';
      default: return 'Desconhecido';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'pending': return 'time';
      case 'in_progress': return 'hourglass';
      case 'resolved': return 'checkmark-circle';
      default: return 'help-circle';
    }
  };

  const renderConnectionStatus = () => (
    <View style={[styles.connectionStatus, isConnected ? styles.connected : styles.disconnected]}>
      <Ionicons 
        name={isConnected ? 'wifi' : 'wifi-outline'} 
        size={16} 
        color="#FFFFFF" 
      />
      <Text style={styles.connectionText}>
        {isConnected ? 'Online' : 'Offline'}
      </Text>
      {pendingAlerts.length > 0 && (
        <View style={styles.pendingBadge}>
          <Text style={styles.pendingBadgeText}>{pendingAlerts.length}</Text>
        </View>
      )}
    </View>
  );

  const renderPanicMode = () => (
    <SafeAreaView style={styles.panicContainer}>
      <LinearGradient
        colors={['#DC2626', '#B91C1C', '#991B1B']}
        style={styles.panicGradient}
      >
        <StatusBar barStyle="light-content" backgroundColor="#DC2626" />
        
        <View style={styles.panicContent}>
          <Animated.View style={[styles.panicIconContainer, { transform: [{ scale: panicAnim }] }]}>
            <Ionicons name="warning" size={80} color="#FFFFFF" />
          </Animated.View>
          
          <Text style={styles.panicTitle}>🚨 MODO EMERGÊNCIA</Text>
          <Text style={styles.panicSubtitle}>
            Alerta automático será enviado em 10 segundos
          </Text>
          
          <View style={styles.panicActions}>
            <TouchableOpacity
              style={styles.panicCallButton}
              onPress={() => Linking.openURL('tel:193')}
            >
              <Ionicons name="call" size={30} color="#FFFFFF" />
              <Text style={styles.panicCallText}>LIGAR 193</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={styles.panicCancelButton}
              onPress={() => {
                setPanicMode(false);
                setStep(2);
                Vibration.cancel();
              }}
            >
              <Ionicons name="close" size={30} color="#FFFFFF" />
              <Text style={styles.panicCancelText}>CANCELAR</Text>
            </TouchableOpacity>
          </View>
          
          <TouchableOpacity
            style={styles.manualSendButton}
            onPress={autoSendEmergencyAlert}
          >
            <Text style={styles.manualSendText}>ENVIAR ALERTA AGORA</Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>
    </SafeAreaView>
  );

  const renderMediaSection = () => (
    <View style={styles.mediaSection}>
      <Text style={[styles.sectionTitle, isDark && styles.darkText]}>📹 Evidências da Emergência</Text>
      
      {/* Photo Section */}
      <View style={styles.mediaRow}>
        <TouchableOpacity style={styles.mediaButton} onPress={showPhotoOptions}>
          <Ionicons name="camera" size={24} color="#FF6B6B" />
          <Text style={styles.mediaButtonText}>Foto</Text>
        </TouchableOpacity>
        
        {/* Video Section */}
        <TouchableOpacity 
          style={styles.mediaButton} 
          onPress={isRecordingVideo ? stopVideoRecording : startVideoRecording}
        >
          <Ionicons 
            name={isRecordingVideo ? "stop" : "videocam"} 
            size={24} 
            color={isRecordingVideo ? "#EF4444" : "#FF6B6B"} 
          />
          <Text style={styles.mediaButtonText}>
            {isRecordingVideo ? 'Parar' : 'Vídeo'}
          </Text>
        </TouchableOpacity>
        
        {/* Audio Section */}
        <TouchableOpacity 
          style={styles.mediaButton} 
          onPress={isRecording ? stopAudioRecording : startAudioRecording}
        >
          <Ionicons 
            name={isRecording ? "stop" : "mic"} 
            size={24} 
            color={isRecording ? "#EF4444" : "#FF6B6B"} 
          />
          <Text style={styles.mediaButtonText}>
            {isRecording ? 'Parar' : 'Áudio'}
          </Text>
        </TouchableOpacity>
      </View>
      
      {/* Media Preview */}
      <View style={styles.mediaPreview}>
        {photo && (
          <View style={styles.previewItem}>
            <Image source={{ uri: photo.uri }} style={styles.previewImage} />
            <Text style={styles.previewLabel}>📸 Foto</Text>
          </View>
        )}
        
        {video && (
          <View style={styles.previewItem}>
            <Video
              ref={videoRef}
              source={{ uri: video.uri }}
              style={styles.previewVideo}
              shouldPlay={false}
              isLooping={false}
              resizeMode="cover"
            />
            <Text style={styles.previewLabel}>🎥 Vídeo ({Math.round(video.duration/1000)}s)</Text>
          </View>
        )}
        
        {audioRecording && audioRecording.uri && (
          <View style={styles.previewItem}>
            <View style={styles.audioPreview}>
              <Ionicons name="musical-notes" size={40} color="#FF6B6B" />
            </View>
            <Text style={styles.previewLabel}>🎵 Áudio</Text>
          </View>
        )}
      </View>
    </View>
  );

  const renderQuickActionsBar = () => (
    <View style={styles.quickActionsBar}>
      {/* Panic Button */}
      <TouchableOpacity
        style={styles.panicButton}
        onPress={activatePanicMode}
        onLongPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
          Alert.alert(
            'Modo Pânico',
            'Mantenha pressionado por 3 segundos para ativar o modo pânico automático.'
          );
        }}
      >
        <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
          <Ionicons name="warning" size={32} color="#FFFFFF" />
        </Animated.View>
        <Text style={styles.panicButtonText}>PÂNICO</Text>
         </TouchableOpacity>
      
      {/* Quick Call */}
      <TouchableOpacity
        style={styles.quickCallButton}
        onPress={() => Linking.openURL('tel:193')}
      >
        <Ionicons name="call" size={28} color="#FFFFFF" />
        <Text style={styles.quickCallText}>193</Text>
      </TouchableOpacity>
      
      {/* Toggle Shake Detection */}
      <TouchableOpacity
        style={[styles.toggleButton, shakeDetection && styles.toggleButtonActive]}
        onPress={() => setShakeDetection(!shakeDetection)}
      >
        <Ionicons 
          name="phone-portrait" 
          size={24} 
          color={shakeDetection ? "#FFFFFF" : "#666666"} 
        />
        <Text style={[styles.toggleText, shakeDetection && styles.toggleTextActive]}>
          Shake
        </Text>
      </TouchableOpacity>
    </View>
  );

  const renderRegisterStep = () => (
    <Animated.View 
      style={[
        styles.container,
        { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }
      ]}
    >
      <LinearGradient
        colors={['#FF6B6B', '#FF8E8E', '#FFA8A8']}
        style={styles.gradient}
      >
        <SafeAreaView style={styles.safeArea}>
          <ScrollView 
            contentContainerStyle={styles.scrollContent}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
            }
          >
            {renderConnectionStatus()}
            
            <View style={styles.header}>
              <View style={styles.logoContainer}>
                <Animated.View style={[styles.logoCircle, { transform: [{ scale: pulseAnim }] }]}>
                  <Ionicons name="flame" size={32} color="#FFFFFF" />
                </Animated.View>
                <Text style={styles.logoText}>SOS Bombeiros</Text>
              </View>
              <Text style={styles.subtitle}>Sistema de Alerta de Incêndios</Text>
              {/* <Text style={styles.version}>v2.0.0 Premium</Text> */}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Seus Dados</Text>
              <Text style={styles.cardSubtitle}>
                Para enviar alertas de emergência rapidamente
              </Text>

              <View style={styles.inputContainer}>
                <Ionicons name="person" size={20} color="#FF6B6B" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Seu nome completo"
                  placeholderTextColor="#9CA3AF"
                  value={userName}
                  onChangeText={setUserName}
                  autoCapitalize="words"
                />
              </View>

              <View style={styles.inputContainer}>
                <Ionicons name="call" size={20} color="#FF6B6B" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Número do celular"
                  placeholderTextColor="#9CA3AF"
                  keyboardType="phone-pad"
                  value={userPhone}
                  onChangeText={setUserPhone}
                />
              </View>

              <TouchableOpacity style={styles.locationContainer} onPress={getCurrentLocation}>
                <Ionicons 
                  name={location ? "location" : "location-outline"} 
                  size={20} 
                  color={location ? "#10B981" : "#F59E0B"} 
                />
                <Text style={[styles.locationText, { color: location ? "#059669" : "#D97706" }]}>
                  {loading ? 'Obtendo localização...' : 
                   location ? location.address : 'Toque para obter localização'}
                </Text>
                {loading && <ActivityIndicator size="small" color="#F59E0B" />}
              </TouchableOpacity>

              <TouchableOpacity 
                style={[styles.primaryButton, (!userName || !userPhone || !location) && styles.buttonDisabled]}
                onPress={() => {
                  saveUserData();
                  setStep(2);
                }}
                disabled={!userName || !userPhone || !location}
              >
                <Text style={styles.primaryButtonText}>Continuar</Text>
                <Ionicons name="arrow-forward" size={20} color="#FFFFFF" />
              </TouchableOpacity>

              <TouchableOpacity style={styles.emergencyCallButton} onPress={emergencyCall}>
                <Ionicons name="call" size={20} color="#FFFFFF" />
                <Text style={styles.emergencyCallText}>Ligação de Emergência 193</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </SafeAreaView>
      </LinearGradient>
    </Animated.View>
  );

  const renderAlertStep = () => (
    <SafeAreaView style={[styles.safeArea, isDark && styles.darkContainer]}>
      <View style={styles.alertHeader}>
        <TouchableOpacity onPress={() => setStep(1)} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#FF6B6B" />
        </TouchableOpacity>
        <Text style={[styles.alertTitle, isDark && styles.darkText]}>
          Emergência de Incêndio
        </Text>
        <TouchableOpacity onPress={() => setStep(3)} style={styles.historyButton}>
          <Ionicons name="time" size={24} color="#FF6B6B" />
        </TouchableOpacity>
      </View>

      {renderConnectionStatus()}
      {renderQuickActionsBar()}

      <ScrollView 
        ref={scrollViewRef}
        style={styles.scrollView} 
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <View style={[styles.emergencyCard, isDark && styles.darkCard]}>
          <Animated.View style={[styles.emergencyIcon, { transform: [{ scale: pulseAnim }] }]}>
            <Ionicons name="flame" size={32} color="#FFFFFF" />
          </Animated.View>
          <Text style={styles.emergencyTitle}>🔥 Situação de Emergência</Text>
          <Text style={styles.emergencySubtitle}>
            Documente a situação e solicite ajuda imediata
          </Text>
        </View>

        {renderMediaSection()}

        {/* Message Section */}
        <View style={styles.messageSection}>
          <Text style={[styles.sectionTitle, isDark && styles.darkText]}>
            💬 Descrição Detalhada
          </Text>
          <TextInput
            style={[styles.messageInput, isDark && styles.darkInput]}
            placeholder="Descreva o que está acontecendo: tamanho do fogo, pessoas em risco, localização exata..."
            placeholderTextColor={isDark ? "#9CA3AF" : "#6B7280"}
            multiline
            numberOfLines={5}
            value={message}
            onChangeText={setMessage}
            maxLength={1000}
          />
          <View style={styles.inputFooter}>
            <Text style={styles.characterCount}>{message.length}/1000 caracteres</Text>
            <TouchableOpacity
              style={styles.voiceInputButton}
              onPress={isRecording ? stopAudioRecording : startAudioRecording}
            >
              <Ionicons 
                name={isRecording ? "stop" : "mic"} 
                size={20} 
                color={isRecording ? "#EF4444" : "#FF6B6B"} 
              />
              <Text style={styles.voiceInputText}>
                {isRecording ? 'Gravando...' : 'Gravar áudio'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Location Section Enhanced */}
        <View style={styles.locationSection}>
          <Text style={[styles.sectionTitle, isDark && styles.darkText]}>📍 Localização Precisa</Text>
          <TouchableOpacity style={[styles.locationCard, isDark && styles.darkCard]} onPress={getCurrentLocation}>
            <View style={styles.locationInfo}>
              <Ionicons name="location" size={24} color="#10B981" />
              <View style={styles.locationText}>
                <Text style={[styles.locationCardText, isDark && styles.darkText]}>
                  {location ? location.address : 'Obtendo localização...'}
                </Text>
                {location && (
                  <Text style={styles.coordinatesText}>
                    📌 {location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}
                  </Text>
                )}
              </View>
            </View>
            <Ionicons name="refresh" size={20} color="#10B981" />
          </TouchableOpacity>
          
          {/* What3Words Integration Placeholder */}
          <View style={styles.what3wordsContainer}>
            <Ionicons name="globe" size={16} color="#0066CC" />
            <Text style={styles.what3wordsText}>
              📍 mesa.livro.casa (localização em 3 palavras)
            </Text>
          </View>
        </View>

        {/* Priority Level Selector */}
        <View style={styles.prioritySection}>
          <Text style={[styles.sectionTitle, isDark && styles.darkText]}>🚨 Nível de Urgência</Text>
          <View style={styles.priorityButtons}>
            <TouchableOpacity style={[styles.priorityButton, styles.priorityLow]}>
              <Ionicons name="leaf" size={20} color="#10B981" />
              <Text style={styles.priorityText}>Baixo</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.priorityButton, styles.priorityMedium]}>
              <Ionicons name="warning" size={20} color="#F59E0B" />
              <Text style={styles.priorityText}>Médio</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.priorityButton, styles.priorityHigh, styles.prioritySelected]}>
              <Ionicons name="flame" size={20} color="#FFFFFF" />
              <Text style={[styles.priorityText, styles.prioritySelectedText]}>CRÍTICO</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Enhanced Send Button */}
        <TouchableOpacity 
          style={[styles.sendButton, loading && styles.sendButtonDisabled]}
          onPress={sendAlert}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <>
              <Ionicons name="send" size={24} color="#FFFFFF" />
              <Text style={styles.sendButtonText}>🚨 ENVIAR ALERTA CRÍTICO</Text>
            </>
          )}
        </TouchableOpacity>

        {/* Emergency Contacts */}
        <View style={styles.emergencyContactsSection}>
          <Text style={[styles.sectionTitle, isDark && styles.darkText]}>📞 Contatos de Emergência</Text>
          <View style={styles.contactButtons}>
            <TouchableOpacity 
              style={styles.contactButton}
              onPress={() => Linking.openURL('tel:193')}
            >
              <Ionicons name="flame" size={20} color="#FFFFFF" />
              <Text style={styles.contactButtonText}>Bombeiros - 193</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.contactButton}
              onPress={() => Linking.openURL('tel:112')}
            >
              <Ionicons name="medical" size={20} color="#FFFFFF" />
              <Text style={styles.contactButtonText}>Emergência - 112</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );

  const renderHistoryStep = () => (
    <SafeAreaView style={[styles.safeArea, isDark && styles.darkContainer]}>
      <View style={styles.historyHeader}>
        <TouchableOpacity onPress={() => setStep(2)} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#FF6B6B" />
        </TouchableOpacity>
        <Text style={[styles.historyTitle, isDark && styles.darkText]}>Meus Alertas</Text>
        <TouchableOpacity onPress={onRefresh} style={styles.refreshButton}>
          <Ionicons name="refresh" size={24} color="#FF6B6B" />
        </TouchableOpacity>
      </View>

      {renderConnectionStatus()}

      <ScrollView 
        style={styles.scrollView} 
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {alerts.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="document-text-outline" size={64} color="#D1D5DB" />
            <Text style={[styles.emptyStateTitle, isDark && styles.darkText]}>Nenhum alerta enviado</Text>
            <Text style={[styles.emptyStateText, isDark && styles.darkText]}>
              Quando você enviar alertas de emergência, eles aparecerão aqui
            </Text>
            <TouchableOpacity 
              style={styles.newAlertButton}
              onPress={() => setStep(2)}
            >
              <Text style={styles.newAlertButtonText}>Enviar Primeiro Alerta</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.alertsStats}>
              <View style={[styles.statCard, isDark && styles.darkCard]}>
                <Text style={[styles.statNumber, isDark && styles.darkText]}>{alerts.length}</Text>
                <Text style={styles.statLabel}>Total</Text>
              </View>
              <View style={[styles.statCard, isDark && styles.darkCard]}>
                <Text style={[styles.statNumber, { color: '#EF4444' }]}>
                  {alerts.filter(a => a.status === 'pending').length}
                </Text>
                <Text style={styles.statLabel}>Pendentes</Text>
              </View>
              <View style={[styles.statCard, isDark && styles.darkCard]}>
                <Text style={[styles.statNumber, { color: '#10B981' }]}>
                  {alerts.filter(a => a.status === 'resolved').length}
                </Text>
                <Text style={styles.statLabel}>Resolvidos</Text>
              </View>
            </View>

            {alerts.map((alert) => (
              <View key={alert.id} style={[styles.alertCard, isDark && styles.darkCard]}>
                <View style={styles.alertCardHeader}>
                  <View style={styles.alertIdContainer}>
                    <Ionicons 
                      name={getStatusIcon(alert.status)} 
                      size={16} 
                      color={getStatusColor(alert.status)} 
                    />
                    <Text style={[styles.alertId, isDark && styles.darkText]}>#{alert.id}</Text>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: getStatusColor(alert.status) }]}>
                    <Text style={styles.statusText}>{getStatusText(alert.status)}</Text>
                  </View>
                </View>
                
                <Text style={[styles.alertMessage, isDark && styles.darkText]}>
                  {alert.message || 'Alerta de emergência sem descrição'}
                </Text>
                
                <View style={styles.alertDetails}>
                  <View style={styles.alertLocation}>
                    <Ionicons name="location" size={16} color="#6B7280" />
                    <Text style={styles.alertLocationText}>{alert.location}</Text>
                  </View>
                  
                  <View style={styles.alertTime}>
                    <Ionicons name="time" size={16} color="#6B7280" />
                    <Text style={styles.alertTimeText}>
                      {new Date(alert.created_at).toLocaleString('pt-BR')}
                    </Text>
                  </View>
                </View>

                {alert.photo && (
                  <Image 
                    source={{ uri: `${API_BASE_URL.replace('/api', '')}/storage/${alert.photo}` }} 
                    style={styles.alertPhoto} 
                  />
                )}
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );

  // Main render logic
  if (step === 4 && panicMode) {
    return renderPanicMode();
  }

  return (
    <View style={[styles.container, isDark && styles.darkContainer]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />
      {step === 1 && renderRegisterStep()}
      {step === 2 && renderAlertStep()}
      {step === 3 && renderHistoryStep()}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  darkContainer: {
    backgroundColor: '#1F2937',
  },
  darkText: {
    color: '#F3F4F6',
  },
  darkCard: {
    backgroundColor: '#374151',
  },
  darkInput: {
    backgroundColor: '#4B5563',
    borderColor: '#6B7280',
    color: '#F3F4F6',
  },
  gradient: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 20,
  },
  connectionStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    margin: 16,
    alignSelf: 'center',
  },
  connected: {
    backgroundColor: '#10B981',
  },
  disconnected: {
    backgroundColor: '#EF4444',
  },
  connectionText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },
  pendingBadge: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginLeft: 8,
  },
  pendingBadgeText: {
    color: '#EF4444',
    fontSize: 10,
    fontWeight: 'bold',
  },
  header: {
    alignItems: 'center',
    paddingTop: 20,
    paddingBottom: 20,
  },
  logoContainer: {
    alignItems: 'center',
    // marginBottom: 10,
  },
  logoCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  logoText: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  subtitle: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.9)',
    textAlign: 'center',
    marginBottom: 4,
  },
  version: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.7)',
  },
  card: {
    backgroundColor: '#FFFFFF',
    margin: 20,
    borderRadius: 20,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  cardTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1F2937',
    marginBottom: 8,
  },
  cardSubtitle: {
    fontSize: 16,
    color: '#6B7280',
    marginBottom: 32,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    paddingHorizontal: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#1F2937',
    paddingVertical: 16,
  },
  locationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0FDF4',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#D1FAE5',
  },
  locationText: {
    fontSize: 14,
    marginLeft: 8,
    flex: 1,
  },
  primaryButton: {
    backgroundColor: '#FF6B6B',
    borderRadius: 12,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#FF6B6B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
    marginBottom: 16,
  },
  buttonDisabled: {
    backgroundColor: '#9CA3AF',
    shadowColor: '#9CA3AF',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
    marginRight: 8,
  },
  emergencyCallButton: {
    backgroundColor: '#DC2626',
    borderRadius: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emergencyCallText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },

  // Panic Mode Styles
  panicContainer: {
    flex: 1,
  },
  panicGradient: {
    flex: 1,
  },
  panicContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  panicIconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 30,
  },
  panicTitle: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 10,
  },
  panicSubtitle: {
    fontSize: 18,
    color: 'rgba(255, 255, 255, 0.9)',
    textAlign: 'center',
    marginBottom: 40,
  },
  panicActions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    marginBottom: 30,
  },
  panicCallButton: {
    backgroundColor: '#059669',
    paddingVertical: 20,
    paddingHorizontal: 30,
    borderRadius: 20,
    alignItems: 'center',
    minWidth: 120,
  },
  panicCallText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
    marginTop: 5,
  },
  panicCancelButton: {
    backgroundColor: '#6B7280',
    paddingVertical: 20,
    paddingHorizontal: 30,
    borderRadius: 20,
    alignItems: 'center',
    minWidth: 120,
  },
  panicCancelText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
    marginTop: 5,
  },
  manualSendButton: {
    backgroundColor: '#FFFFFF',
    paddingVertical: 15,
    paddingHorizontal: 40,
    borderRadius: 25,
  },
  manualSendText: {
    color: '#DC2626',
    fontSize: 18,
    fontWeight: 'bold',
  },

  // Quick Actions Bar
  quickActionsBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingVertical: 15,
    paddingHorizontal: 20,
    marginHorizontal: 20,
    marginVertical: 10,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  panicButton: {
    backgroundColor: '#DC2626',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 15,
    alignItems: 'center',
  },
  panicButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
    marginTop: 4,
  },
  quickCallButton: {
    backgroundColor: '#059669',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 15,
    alignItems: 'center',
  },
  quickCallText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
    marginTop: 4,
  },
  toggleButton: {
    backgroundColor: '#E5E7EB',
    paddingVertical: 12,
    paddingHorizontal: 15,
    borderRadius: 15,
    alignItems: 'center',
  },
  toggleButtonActive: {
    backgroundColor: '#3B82F6',
  },
  toggleText: {
    color: '#666666',
    fontSize: 10,
    fontWeight: '600',
    marginTop: 4,
  },
  toggleTextActive: {
    color: '#FFFFFF',
  },

  // Alert Header
  alertHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 10,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FEF2F2',
    justifyContent: 'center',
    alignItems: 'center',
  },
  alertTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1F2937',
  },
  historyButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FEF2F2',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollView: {
    flex: 1,
  },
  emergencyCard: {
    backgroundColor: '#FEF2F2',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    marginHorizontal: 20,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  emergencyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#EF4444',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emergencyTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#DC2626',
    marginBottom: 8,
    textAlign: 'center',
  },
  emergencySubtitle: {
    fontSize: 14,
    color: '#7F1D1D',
    textAlign: 'center',
  },

  // Media Section
  mediaSection: {
    marginHorizontal: 20,
    marginBottom: 24,
  },
  mediaRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 20,
  },
  mediaButton: {
    backgroundColor: '#FEF2F2',
    paddingVertical: 15,
    paddingHorizontal: 20,
    borderRadius: 15,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FECACA',
    minWidth: 80,
  },
  mediaButtonText: {
    color: '#FF6B6B',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  mediaPreview: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
  },
  previewItem: {
    alignItems: 'center',
    marginBottom: 10,
  },
  previewImage: {
    width: 80,
    height: 80,
    borderRadius: 10,
    marginBottom: 5,
  },
  previewVideo: {
    width: 80,
    height: 80,
    borderRadius: 10,
    marginBottom: 5,
  },
  audioPreview: {
    width: 80,
    height: 80,
    backgroundColor: '#FEF2F2',
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 5,
  },
  previewLabel: {
    fontSize: 10,
    color: '#6B7280',
    textAlign: 'center',
  },

  // Enhanced Message Section
  messageSection: {
    marginHorizontal: 20,
    marginBottom: 24,
  },
  messageInput: {
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#1F2937',
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 8,
  },
  inputFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  characterCount: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  voiceInputButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  voiceInputText: {
    fontSize: 12,
    color: '#FF6B6B',
    marginLeft: 4,
    fontWeight: '600',
  },

  // Enhanced Location Section
  locationSection: {
    marginHorizontal: 20,
    marginBottom: 24,
  },
  locationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F0FDF4',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#D1FAE5',
    marginBottom: 8,
  },
  locationInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  locationCardText: {
    fontSize: 14,
    color: '#059669',
    fontWeight: '600',
  },
  coordinatesText: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  what3wordsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  what3wordsText: {
    fontSize: 12,
    color: '#0066CC',
    marginLeft: 4,
    fontWeight: '600',
  },

  // Priority Section
  prioritySection: {
    marginHorizontal: 20,
    marginBottom: 24,
  },
  priorityButtons: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  priorityButton: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 2,
    minWidth: 80,
  },
  priorityLow: {
    backgroundColor: '#F0FDF4',
    borderColor: '#D1FAE5',
  },
  priorityMedium: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  priorityHigh: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  prioritySelected: {
    backgroundColor: '#EF4444',
    borderColor: '#EF4444',
  },
  priorityText: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
    color: '#6B7280',
  },
  prioritySelectedText: {
    color: '#FFFFFF',
  },

  // Emergency Contacts Section
  emergencyContactsSection: {
    marginHorizontal: 20,
    marginBottom: 24,
  },
  contactButtons: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  contactButton: {
    backgroundColor: '#DC2626',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignItems: 'center',
    flexDirection: 'row',
    minWidth: 140,
  },
  contactButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
    marginLeft: 8,
  },

  // Send Button
  sendButton: {
    backgroundColor: '#EF4444',
    borderRadius: 12,
    paddingVertical: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 20,
    marginBottom: 12,
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  sendButtonDisabled: {
    backgroundColor: '#9CA3AF',
    shadowColor: '#9CA3AF',
  },
  sendButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
    marginLeft: 8,
  },

  // History Section
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 10,
  },
  historyTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1F2937',
  },
  refreshButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FEF2F2',
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 20,
  },
  emptyStateTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#374151',
    marginTop: 16,
    marginBottom: 8,
  },
  emptyStateText: {
    fontSize: 16,
    color: '#9CA3AF',
    textAlign: 'center',
    marginBottom: 24,
  },
  newAlertButton: {
    backgroundColor: '#FF6B6B',
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  newAlertButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  alertsStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginHorizontal: 20,
    marginBottom: 20,
  },
  statCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  statNumber: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1F2937',
  },
  statLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 4,
  },
  alertCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 20,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  alertCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  alertIdContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  alertId: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#6B7280',
    marginLeft: 4,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
  },
  statusText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  alertMessage: {
    fontSize: 14,
    color: '#1F2937',
    marginBottom: 12,
    lineHeight: 20,
  },
  alertDetails: {
    marginBottom: 12,
  },
  alertLocation: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  alertLocationText: {
    fontSize: 12,
    color: '#6B7280',
    marginLeft: 4,
    flex: 1,
  },
  alertTime: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  alertTimeText: {
    fontSize: 12,
    color: '#6B7280',
    marginLeft: 4,
  },
  alertPhoto: {
    width: '100%',
    height: 120,
    borderRadius: 8,
    marginTop: 8,
  },

  // Section Title
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1F2937',
    marginBottom: 12,
  },
});


export default FireAlertApp;