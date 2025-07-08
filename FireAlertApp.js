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
} from 'react-native';
import { Camera } from 'expo-camera';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

const { width, height } = Dimensions.get('window');

const API_BASE_URL = 'http://192.168.100.6:8000/api';

const FireAlertApp = () => {
  const [step, setStep] = useState(1); // 1: Register, 2: Alert, 3: History
  const [userName, setUserName] = useState('');
  const [userPhone, setUserPhone] = useState('');
  const [message, setMessage] = useState('');
  const [photo, setPhoto] = useState(null);
  const [location, setLocation] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [isConnected, setIsConnected] = useState(true);
  const [pendingAlerts, setPendingAlerts] = useState([]);
  const [fadeAnim] = useState(new Animated.Value(0));
  const [slideAnim] = useState(new Animated.Value(50));
  const [pulseAnim] = useState(new Animated.Value(1));
  const scrollViewRef = useRef(null);

  useEffect(() => {
    initializeApp();
    setupNetworkListener();
    setupBackHandler();
    animateIn();
  }, []);

  useEffect(() => {
    if (step === 1) {
      loadStoredUserData();
    } else if (step === 3) {
      loadAlerts();
    }
  }, [step]);

  const setupBackHandler = () => {
    const backAction = () => {
      if (step === 2) {
        setStep(1);
        return true;
      } else if (step === 3) {
        setStep(2);
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
  };

  const startPulseAnimation = () => {
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
        uri: alertData.photo.uri,
        type: 'image/jpeg',
        name: 'alert_photo.jpg',
      });
    }
    
    const response = await fetch(`${API_BASE_URL}/alerts`, {
        method: 'POST',
        headers: {
            'Content-Type': 'multipart/form-data',
        },
        body: formData,
        
    });
    console.log(response);
    if (!response.ok) {
      throw new Error('Falha ao enviar alerta');
    }

    return await response.json();
  };

  const sendAlert = async () => {
    if (!userName || !userPhone || !location || !location.address) {
      Alert.alert('Erro', 'Por favor, preencha todos os campos obrigatórios, incluindo localização.');
      return;
    }
  
    const alertData = {
      userName,
      userPhone,
      message,
      location,
      photo,
      timestamp: new Date().toISOString(),
    };
  
    setLoading(true);
    startPulseAnimation();
  
    try {
      await saveUserData();
  
      if (!isConnected) {
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
            { text: 'Ver histórico', onPress: () => { clearForm(); setStep(3); loadAlerts(); } },
            { text: 'Enviar novo alerta', onPress: clearForm }
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
                <Text style={styles.logoText}>SOS Mombeiro</Text>
              </View>
              <Text style={styles.subtitle}>Sistema de Alerta de Incêndios</Text>
              {/* <Text style={styles.version}>v1.0.0</Text> */}
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
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.alertHeader}>
        <TouchableOpacity onPress={() => setStep(1)} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#FF6B6B" />
        </TouchableOpacity>
        <Text style={styles.alertTitle}>Alerta de Emergência</Text>
        <TouchableOpacity onPress={() => setStep(3)} style={styles.historyButton}>
          <Ionicons name="time" size={24} color="#FF6B6B" />
        </TouchableOpacity>
      </View>

      {renderConnectionStatus()}

      <ScrollView 
        ref={scrollViewRef}
        style={styles.scrollView} 
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <View style={styles.emergencyCard}>
          <Animated.View style={[styles.emergencyIcon, { transform: [{ scale: pulseAnim }] }]}>
            <Ionicons name="warning" size={32} color="#FFFFFF" />
          </Animated.View>
          <Text style={styles.emergencyTitle}>🚨 Situação de Emergência</Text>
          <Text style={styles.emergencySubtitle}>
            Preencha os dados abaixo para solicitar ajuda imediata dos bombeiros
          </Text>
        </View>

        <View style={styles.photoSection}>
          <Text style={styles.sectionTitle}>📸 Foto da Situação</Text>
          {photo ? (
            <View style={styles.photoContainer}>
              <Image source={{ uri: photo.uri }} style={styles.photoPreview} />
              <View style={styles.photoActions}>
                <TouchableOpacity style={styles.retakeButton} onPress={showPhotoOptions}>
                  <Ionicons name="camera" size={20} color="#FFFFFF" />
                  <Text style={styles.retakeButtonText}>Alterar Foto</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.removePhotoButton} onPress={() => setPhoto(null)}>
                  <Ionicons name="trash" size={20} color="#FFFFFF" />
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity style={styles.cameraButton} onPress={showPhotoOptions}>
              <Ionicons name="camera" size={32} color="#FF6B6B" />
              <Text style={styles.cameraButtonText}>Adicionar Foto</Text>
              <Text style={styles.cameraButtonSubtext}>Toque para fotografar a situação</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.messageSection}>
          <Text style={styles.sectionTitle}>💬 Descrição (Opcional)</Text>
          <TextInput
            style={styles.messageInput}
            placeholder="Descreva brevemente a situação de emergência..."
            placeholderTextColor="#9CA3AF"
            multiline
            numberOfLines={4}
            value={message}
            onChangeText={setMessage}
            maxLength={500}
          />
          <Text style={styles.characterCount}>{message.length}/500 caracteres</Text>
        </View>

        <View style={styles.locationSection}>
          <Text style={styles.sectionTitle}>📍 Sua Localização</Text>
          <TouchableOpacity style={styles.locationCard} onPress={getCurrentLocation}>
            <Ionicons name="location" size={20} color="#10B981" />
            <Text style={styles.locationCardText}>
              {location ? location.address : 'Carregando...'}
            </Text>
            <Ionicons name="refresh" size={16} color="#10B981" />
          </TouchableOpacity>
        </View>

        <TouchableOpacity 
          style={[styles.sendButton, loading && styles.sendButtonDisabled]}
          onPress={sendAlert}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <>
              <Ionicons name="send" size={20} color="#FFFFFF" />
              <Text style={styles.sendButtonText}>🚨 ENVIAR ALERTA DE EMERGÊNCIA</Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.emergencyCallButton} onPress={emergencyCall}>
          <Ionicons name="call" size={20} color="#FFFFFF" />
          <Text style={styles.emergencyCallText}>Ligação Direta: 193</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );

  const renderHistoryStep = () => (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.historyHeader}>
        <TouchableOpacity onPress={() => setStep(2)} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#FF6B6B" />
        </TouchableOpacity>
        <Text style={styles.historyTitle}>Meus Alertas</Text>
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
            <Text style={styles.emptyStateTitle}>Nenhum alerta enviado</Text>
            <Text style={styles.emptyStateText}>
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
              <View style={styles.statCard}>
                <Text style={styles.statNumber}>{alerts.length}</Text>
                <Text style={styles.statLabel}>Total</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={[styles.statNumber, { color: '#EF4444' }]}>
                  {alerts.filter(a => a.status === 'pending').length}
                </Text>
                <Text style={styles.statLabel}>Pendentes</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={[styles.statNumber, { color: '#10B981' }]}>
                  {alerts.filter(a => a.status === 'resolved').length}
                </Text>
                <Text style={styles.statLabel}>Resolvidos</Text>
              </View>
            </View>

            {alerts.map((alert) => (
              <View key={alert.id} style={styles.alertCard}>
                <View style={styles.alertCardHeader}>
                  <View style={styles.alertIdContainer}>
                    <Ionicons 
                      name={getStatusIcon(alert.status)} 
                      size={16} 
                      color={getStatusColor(alert.status)} 
                    />
                    <Text style={styles.alertId}>#{alert.id}</Text>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: getStatusColor(alert.status) }]}>
                    <Text style={styles.statusText}>{getStatusText(alert.status)}</Text>
                  </View>
                </View>
                
                <Text style={styles.alertMessage}>
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

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#FF6B6B" />
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
    // paddingTop: 20,
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
    paddingHorizontal: 20,
  },
  emergencyCard: {
    backgroundColor: '#FEF2F2',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
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
  photoSection: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1F2937',
    marginBottom: 12,
  },
  photoContainer: {
    alignItems: 'center',
  },
  photoPreview: {
    width: '100%',
    height: 200,
    borderRadius: 12,
    marginBottom: 12,
  },
  photoActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  retakeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#6B7280',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginRight: 8,
  },
  retakeButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    marginLeft: 8,
  },
  removePhotoButton: {
    backgroundColor: '#EF4444',
    borderRadius: 8,
    padding: 8,
  },
  cameraButton: {
    backgroundColor: '#FEF2F2',
    borderRadius: 12,
    paddingVertical: 32,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FECACA',
    borderStyle: 'dashed',
  },
  cameraButtonText: {
    color: '#FF6B6B',
    fontSize: 16,
    fontWeight: '600',
    marginTop: 8,
  },
  cameraButtonSubtext: {
    color: '#9CA3AF',
    fontSize: 12,
    marginTop: 4,
  },
  messageSection: {
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
  characterCount: {
    fontSize: 12,
    color: '#9CA3AF',
    textAlign: 'right',
  },
  locationSection: {
    marginBottom: 32,
  },
  locationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0FDF4',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#D1FAE5',
  },
  locationCardText: {
    fontSize: 14,
    color: '#059669',
    marginLeft: 8,
    flex: 1,
  },
  sendButton: {
    backgroundColor: '#EF4444',
    borderRadius: 12,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
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
});

export default FireAlertApp;